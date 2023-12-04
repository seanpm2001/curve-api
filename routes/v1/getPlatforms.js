/**
 * Returns platforms that Curve is deployed on, and which pool registries
 * are available on each platform.
 *
 * Useful to then query e.g. `/api/getPools/PLATFORM/REGISTRY`
 */

import configs from '#root/constants/configs/index.js'
import { arrayToHashmap } from '#root/utils/Array.js';
import { fn } from '#root/utils/api.js';
import getPlatformRegistries from '#root/utils/data/curve-platform-registries.js';

const allBlockchainIds = Array.from(Object.keys(configs));

export default fn(async () => ({
  platforms: arrayToHashmap(await Promise.all(allBlockchainIds.map(async (blockchainId) => [
    blockchainId,
    (await getPlatformRegistries(blockchainId)).registryIds,
  ]))),
}), {
  maxAge: 60 * 60, // 1h
  cacheKey: 'getPlatforms',
});
