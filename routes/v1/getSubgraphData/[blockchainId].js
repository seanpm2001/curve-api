/**
 * @openapi
 * /getSubgraphData/{blockchainId}:
 *   get:
 *     tags:
 *       - Volumes and APYs
 *     description: |
 *       Returns all 24h volume and base APY data for Curve pools on each chain.
 *       It relies on [Curve subgraphs](https://github.com/curvefi/volume-subgraphs), and is being slowly transitioned to the more reliable [`/getVolumes/{blockchainId}`](#/default/get_getVolumes__blockchainId_) endpoint (where support for more chains is being added). When this transition is done, this endpoint will however remain available as simple proxy for [`/getVolumes/{blockchainId}`](#/default/get_getVolumes__blockchainId_).
 *     parameters:
 *       - $ref: '#/components/parameters/blockchainId'
 *     responses:
 *       200:
 *         description:
 */

import Web3 from 'web3';
import BN from 'bignumber.js';
import { fn, NotFoundError } from '#root/utils/api.js';
import { IS_DEV, USE_FALLBACK_THEGRAPH_DATA } from '#root/constants/AppConstants.js';
import configs from '#root/constants/configs/index.js';
import { runConcurrentlyAtMost } from '#root/utils/Async.js';
import { uintToBN } from '#root/utils/Web3/index.js';
import getAllCurvePoolsData from '#root/utils/data/curve-pools-data.js';
import getVolumesFn, { AVAILABLE_CHAIN_IDS as AVAILABLE_CHAIN_IDS_FOR_GET_VOLUMES }
  from '#root/routes/v1/getVolumes/[blockchainId].js';
import getPoolListFn from '#root/routes/v1/getPoolList/[blockchainId].js';
import { sumBN } from '#root/utils/Array.js';

const lc = (str) => str.toLowerCase();

// Pools for which volume data on the subgraph is incorrect, and needs
// to be overriden with a manual calculation.
const POOLS_WITH_INCORRECT_SUBGRAPH_USD_VOLUME = {
  ethereum: [
    '0x84997FAFC913f1613F51Bb0E2b5854222900514B',
    '0x2863a328a0b7fc6040f11614fa0728587db8e353',
    '0xb7ecb2aa52aa64a717180e030241bc75cd946726',
    '0xf95aaa7ebb1620e46221b73588502960ef63dba0',
    '0xc15f285679a1ef2d25f53d4cbd0265e1d02f2a92',
    '0x1062fd8ed633c1f080754c19317cb3912810b5e5',
    '0x28ca243dc0ac075dd012fcf9375c25d18a844d96',
  ].map(lc),
  polygon: [
    '0x7c1aa4989df27970381196d3ef32a7410e3f2748',
    '0xB05475d2A99ec4f7fa9ff1Ffb0e65894d2A639f3',
    '0x8914B29F7Bea602A183E89D6843EcB251D56D07e',
    '0xa7C475FC82422F2E9cEfd6E6C9Ab4Ee9660cB421',
    '0x9b3d675FDbe6a0935E8B7d1941bc6f78253549B7',
  ].map(lc),
};

const getFallbackData = async (fallbackDataFileName) => (
  (await import(`./_fallback-data/${fallbackDataFileName}.json`, { assert: { type: 'json' } })).default
);

export default fn(async ({ blockchainId }) => {
  // If the newest, more accurate method of retrieving volumes is available
  // for this chain, return it instead with backward-compatible data structure
  if (AVAILABLE_CHAIN_IDS_FOR_GET_VOLUMES.includes(blockchainId)) {
    const data = await getVolumesFn.straightCall({ blockchainId });

    return {
      poolList: data.pools.map(({
        address,
        type,
        volumeUSD,
        latestDailyApyPcent,
        latestWeeklyApyPcent,
        virtualPrice,
      }) => ({
        address,
        latestDailyApy: latestDailyApyPcent,
        latestWeeklyApy: latestWeeklyApyPcent,
        rawVolume: null, // Not available, and unused in all clients we know of
        type,
        virtualPrice,
        volumeUSD,
      })),
      subgraphHasErrors: false,
      cryptoShare: data.totalVolumes.cryptoVolumeSharePcent,
      cryptoVolume: data.totalVolumes.totalCryptoVolume,
      totalVolume: data.totalVolumes.totalVolume,
    };
  }

  const fallbackDataFileName = `getSubgraphData-${blockchainId}`;

  if (USE_FALLBACK_THEGRAPH_DATA && typeof fallbackDataFileName !== 'undefined') {
    return getFallbackData(fallbackDataFileName);
  }

  const config = configs[blockchainId];
  const GRAPH_ENDPOINT = config.graphEndpoint;
  if (!GRAPH_ENDPOINT) throw new NotFoundError('No subgraph endpoint');

  try {
    const web3 = new Web3(config.rpcUrl);

    if (typeof config === 'undefined') {
      throw new NotFoundError(`No factory data for blockchainId "${blockchainId}"`);
    }

    const CURRENT_TIMESTAMP = Math.round(new Date().getTime() / 1000);
    const TIMESTAMP_24H_AGO = CURRENT_TIMESTAMP - (25 * 3600);

    let subgraphHasErrors = false;

    const allPools = await getAllCurvePoolsData([blockchainId]);
    const getPoolByAddress = (address) => (
      allPools.find((pool) => (lc(pool.address) === lc(address)))
    );

    let { poolList } = await getPoolListFn.straightCall({ blockchainId });
    let totalVolume = 0
    let cryptoVolume = 0

    await runConcurrentlyAtMost(poolList.map((_, i) => async () => {
      const poolAddress = lc(poolList[i].address);

      let POOL_QUERY = `
        {
          swapVolumeSnapshots(
            first: 1000,
            orderBy: timestamp,
            orderDirection: desc,
            where: {
              pool: "${poolAddress}"
              timestamp_gt: ${TIMESTAMP_24H_AGO}
              period: 3600
            }
          )
          {
            volume
            volumeUSD
            timestamp
            count
          }
        }
        `
      const res = await fetch(GRAPH_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: POOL_QUERY })
      })

      let data = await res.json()
      let rollingDaySummedVolume = 0
      let rollingRawVolume = 0

      subgraphHasErrors = data.errors?.length > 0;
      if (!subgraphHasErrors) {
        for (let i = 0; i < data.data.swapVolumeSnapshots.length; i++) {
          const hourlyVolUSD = parseFloat(data.data.swapVolumeSnapshots[i].volumeUSD)
          rollingDaySummedVolume = rollingDaySummedVolume + hourlyVolUSD

          const hourlyVol = parseFloat(data.data.swapVolumeSnapshots[i].volume)
          rollingRawVolume = rollingRawVolume + hourlyVol
        }
      }

      const hasRawVolumeButNoUsdVolume = (rollingDaySummedVolume === 0 && rollingRawVolume > 0);
      const needsFallbackUsdVolume = (
        hasRawVolumeButNoUsdVolume ||
        (POOLS_WITH_INCORRECT_SUBGRAPH_USD_VOLUME[blockchainId] || []).includes(poolAddress)
      );

      if (needsFallbackUsdVolume) {
        const ILLIQUID_THRESHOLD = 100;
        const poolData = getPoolByAddress(poolAddress);
        const poolLpTokenPrice = (
          poolData.usdTotal > ILLIQUID_THRESHOLD ?
            (poolData.usdTotal / (poolData.totalSupply / 1e18)) :
            0
        );
        const usdVolumeRectified = poolLpTokenPrice * rollingRawVolume;

        if (usdVolumeRectified > 0 || poolData.usdTotal <= ILLIQUID_THRESHOLD) {
          rollingDaySummedVolume = usdVolumeRectified;

          if (IS_DEV) console.log(`Missing usd volume from subgraph: derived using lp token price from getPools endpoint for pool ${poolAddress} (derived rolling day usd volume: ${usdVolumeRectified})`);
        }
      }

      if (blockchainId === 'ethereum' && (poolAddress === '0x141ace5fd4435fd341e396d579c91df99fed10d4' || poolAddress === '0x2863a328a0b7fc6040f11614fa0728587db8e353')) {
        poolList[i].rawVolume = 0
        poolList[i].volumeUSD = 0
      } else {
        poolList[i].rawVolume = rollingRawVolume
        poolList[i].volumeUSD = rollingDaySummedVolume
      }

      totalVolume += parseFloat(rollingDaySummedVolume)
      cryptoVolume += (poolList[i].type.includes('crypto')) ? parseFloat(rollingDaySummedVolume) : 0


      const APY_QUERY = `
      {
        dailyPoolSnapshots(first: 7,
                          orderBy: timestamp,
                          orderDirection: desc,
                          where:
                          {pool: "${poolList[i].address.toLowerCase()}"})
        {
          baseApr
          xcpProfit
          xcpProfitA
          virtualPrice
          timestamp
        }
      }
      `;

      const resAPY = await fetch(GRAPH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: APY_QUERY }),
      });

      let dataAPY = await resAPY.json();

      const snapshots = dataAPY?.data?.dailyPoolSnapshots?.map((a) => ({
        baseApr: +a.baseApr,
        virtualPrice: +a.virtualPrice,
        xcpProfit: a.xcpProfit ? +a.xcpProfit : undefined,
        xcpProfitA: a.xcpProfitA ? +a.xcpProfitA : undefined,
        timestamp: a.timestamp,
      })) || [];

      let latestDailyApy = 0
      let latestWeeklyApy = 0
      if (snapshots.length >= 2) {
        const isCryptoPool = snapshots[0].xcpProfit > 0;

        if (isCryptoPool && typeof snapshots[0].xcpProfit !== 'undefined' && snapshots[1].xcpProfit !== 0) {
          const currentProfit = ((snapshots[0].xcpProfit / 2) + (snapshots[0].xcpProfitA / 2) + 1e18) / 2;
          const dayOldProfit = ((snapshots[1].xcpProfit / 2) + (snapshots[1].xcpProfitA / 2) + 1e18) / 2;
          const rateDaily = (currentProfit - dayOldProfit) / dayOldProfit;
          latestDailyApy = ((rateDaily + 1) ** 365 - 1) * 100;
        } else if (snapshots[1].virtualPrice !== 0) {
          latestDailyApy = ((snapshots[0].baseApr + 1) ** 365 - 1) * 100;
        }
      }
      if (snapshots.length > 6) {
        const isCryptoPool = snapshots[0].xcpProfit > 0;

        if (isCryptoPool && typeof snapshots[0].xcpProfit !== 'undefined' && snapshots[6].xcpProfit !== 0) {
          const currentProfit = ((snapshots[0].xcpProfit / 2) + (snapshots[0].xcpProfitA / 2) + 1e18) / 2;
          const weekOldProfit = ((snapshots[6].xcpProfit / 2) + (snapshots[6].xcpProfitA / 2) + 1e18) / 2;
          const rateWeekly = (currentProfit - weekOldProfit) / weekOldProfit;
          latestWeeklyApy = ((rateWeekly + 1) ** 52 - 1) * 100;
        } else if (snapshots[6].virtualPrice !== 0) {
          const latestWeeklyRate =
            (snapshots[0].virtualPrice - snapshots[6].virtualPrice) /
            snapshots[0].virtualPrice;
          latestWeeklyApy = ((latestWeeklyRate + 1) ** 52 - 1) * 100;
        }
      }
      poolList[i].latestDailyApy = Math.min(latestDailyApy, 1e6);
      poolList[i].latestWeeklyApy = Math.min(latestWeeklyApy, 1e6);
      poolList[i].virtualPrice = snapshots[0] ? snapshots[0].virtualPrice : undefined;

    }), 10);

    // When a crypto pool uses a base pool lp as one of its underlying assets, apy calculations
    // using xcp_profit need to add up 1/3rd of the underlying pool's base volume
    if (config.CRYPTO_POOLS_WITH_BASE_POOLS) {
      poolList = poolList.map((pool) => {
        if (config.CRYPTO_POOLS_WITH_BASE_POOLS.has(pool.address)) {
          const { latestDailyApy, latestWeeklyApy } = pool;
          const underlyingPoolAddress = config.CRYPTO_POOLS_WITH_BASE_POOLS.get(pool.address);
          const underlyingPool = poolList.find(({ address }) => address.toLowerCase() === underlyingPoolAddress.toLowerCase());
          if (!underlyingPool) {
            console.error(`Couldn't find underlying pool for crypto pool ${pool.address}, hence couldn't add up its base apy`);
            return pool;
          }

          return {
            ...pool,
            latestDailyApy: BN(latestDailyApy).plus(BN(underlyingPool.latestDailyApy).div(3)).toNumber(),
            latestWeeklyApy: BN(latestWeeklyApy).plus(BN(underlyingPool.latestWeeklyApy).div(3)).toNumber(),
          }
        }

        return pool;
      })
    }

    /**
    * Add additional ETH staking APY to pools containing ETH LSDs
    */
    poolList = poolList.map((pool) => {
      const poolData = getPoolByAddress(pool.address);
      if (!poolData) return pool; // Some broken/ignored pools might still be picked up by the subgraph

      const { usesRateOracle, coins, usdTotal } = poolData;
      const needsAdditionalLsdAssetApy = (
        !usesRateOracle &&
        coins.some(({ ethLsdApy }) => typeof ethLsdApy !== 'undefined')
      );

      if (!needsAdditionalLsdAssetApy || usdTotal === 0) return pool;

      const additionalApysPcentFromLsds = coins.map(({
        ethLsdApy,
        poolBalance,
        decimals,
        usdPrice,
      }) => {
        if (typeof ethLsdApy === 'undefined' || usdPrice === null || usdPrice === 0) return 0;

        const assetUsdTotal = uintToBN(poolBalance, decimals).times(usdPrice);
        const assetProportionInPool = assetUsdTotal.div(usdTotal);

        return assetProportionInPool.times(ethLsdApy).times(100);
      });

      return {
        ...pool,
        latestDailyApy: BN(pool.latestDailyApy).plus(sumBN(additionalApysPcentFromLsds)).toNumber(),
        latestWeeklyApy: BN(pool.latestWeeklyApy).plus(sumBN(additionalApysPcentFromLsds)).toNumber(),
      }
    });


    const cryptoShare = (cryptoVolume / totalVolume) * 100

    return { poolList, totalVolume, cryptoVolume, cryptoShare, subgraphHasErrors }
  } catch (err) {
    if (typeof fallbackDataFileName !== 'undefined') {
      console.log(`CAUGHT AND HANDLED GRAPHQL ERROR: "getSubgraphData/${blockchainId}". Fallback data was returned instead of fresh data. The caught error is logged below ↓`);
      console.log(err);

      return getFallbackData(fallbackDataFileName);
    } else {
      throw err;
    }
  }
}, {
  maxAge: 5 * 60, // 5 min
  cacheKey: ({ blockchainId }) => `getSubgraphData-${blockchainId}`,
});
