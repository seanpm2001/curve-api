import Web3 from 'web3';
import memoize from 'memoizee';
import configs from '#root/constants/configs/index.js';
import ADDRESS_GETTER_ABI from '#root/constants/abis/address_getter.json' assert { type: 'json' };
import { multiCall } from '#root/utils/Calls.js';

const getMainRegistryAddress = async (blockchainId) => {
  const { rpcUrl, multicall2Address } = configs[blockchainId];
  const web3 = new Web3(rpcUrl);

  return (await multiCall([{
    address: '0x0000000022d53366457f9d5e68ec105046fc4383',
    abi: ADDRESS_GETTER_ABI,
    methodName: 'get_address',
    params: [0],
    networkSettings: { web3, multicall2Address },
  }]))[0];
};

const getPlatformRegistries = memoize(async (blockchainId) => {
  const config = configs[blockchainId];
  if (typeof config === 'undefined') {
    throw new Error(`No config data for blockchainId "${blockchainId}"`);
  }

  const {
    getFactoryRegistryAddress,
    getCryptoRegistryAddress,
    getFactoryCryptoRegistryAddress,
    getFactoryCrvusdRegistryAddress,
    getFactoryTricryptoRegistryAddress,
    getFactoryEywaRegistryAddress,
    getFactoryStableswapNgRegistryAddress,
    hasNoMainRegistry,
  } = config;

  return {
    registryIds: [
      (!hasNoMainRegistry ? 'main' : null),
      (typeof getFactoryRegistryAddress === 'function' ? 'factory' : null),
      (typeof getCryptoRegistryAddress === 'function' ? 'crypto' : null),
      (typeof getFactoryCryptoRegistryAddress === 'function' ? 'factory-crypto' : null),
      (typeof getFactoryCrvusdRegistryAddress === 'function' ? 'factory-crvusd' : null),
      (typeof getFactoryTricryptoRegistryAddress === 'function' ? 'factory-tricrypto' : null),
      (typeof getFactoryEywaRegistryAddress === 'function' ? 'factory-eywa' : null),
      (typeof getFactoryStableswapNgRegistryAddress === 'function' ? 'factory-stable-ng' : null),
    ].filter((o) => o !== null),
    registryAddresses: [
      (!hasNoMainRegistry ? (await getMainRegistryAddress(blockchainId)) : null),
      (typeof getFactoryRegistryAddress === 'function' ? (await getFactoryRegistryAddress()) : null),
      (typeof getCryptoRegistryAddress === 'function' ? (await getCryptoRegistryAddress()) : null),
      (typeof getFactoryCryptoRegistryAddress === 'function' ? (await getFactoryCryptoRegistryAddress()) : null),
      (typeof getFactoryCrvusdRegistryAddress === 'function' ? (await getFactoryCrvusdRegistryAddress()) : null),
      (typeof getFactoryTricryptoRegistryAddress === 'function' ? (await getFactoryTricryptoRegistryAddress()) : null),
      (typeof getFactoryEywaRegistryAddress === 'function' ? (await getFactoryEywaRegistryAddress()) : null),
      (typeof getFactoryStableswapNgRegistryAddress === 'function' ? (await getFactoryStableswapNgRegistryAddress()) : null),
    ].filter((o) => o !== null),
  };
}, {
  promise: true,
});

export default getPlatformRegistries;
