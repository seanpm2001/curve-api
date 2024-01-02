import memoize from 'memoizee';
import Web3 from 'web3';
import configs from '#root/constants/configs/index.js';
import { lc } from '#root/utils/String.js';
import { multiCall } from '#root/utils/Calls.js';
import AGGREGATOR_STABLE_PRICE_ABI from '#root/constants/abis/AggregatorStablePrice.json' assert { type: 'json' };

const CRVUSD_ADDRESSES = {
  ethereum: lc('0xf939e0a03fb07f59a73314e73794be0e57ac1b4e'),
  base: lc('0x417ac0e078398c154edfadd9ef675d30be60af93'),
  arbitrum: lc('0x498bf2b1e120fed3ad3d42ea2165e9b73f99c1e5'),
};

const AGGREGATOR_STABLE_PRICE_ADDRESS = '0x18672b1b0c623a30089A280Ed9256379fb0E4E62';

const { rpcUrl, multicall2Address } = configs.ethereum;
const web3 = new Web3(rpcUrl);

const getCrvusdPrice = memoize(async () => {
  const [crvusdPrice] = await multiCall([{
    address: AGGREGATOR_STABLE_PRICE_ADDRESS,
    abi: AGGREGATOR_STABLE_PRICE_ABI,
    methodName: 'price',
    networkSettings: { web3, multicall2Address },
  }]);

  return (crvusdPrice / 1e18);
}, {
  promise: true,
  maxAge: 1 * 60 * 1000, // 1 min
});

const getCrvusdPriceForBlockchainId = async (blockchainId) => {
  const isCrvusdDeployedThere = Object.hasOwn(CRVUSD_ADDRESSES, blockchainId);
  if (!isCrvusdDeployedThere) return {};

  const crvusdPrice = await getCrvusdPrice();

  return {
    [CRVUSD_ADDRESSES[blockchainId]]: crvusdPrice,
  };
};

export default getCrvusdPriceForBlockchainId;
