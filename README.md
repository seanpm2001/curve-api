# Documentation

<https://api.curve.fi/v1/documentation>

# Data

## Ethereum LST APYs

When a Curve pool contains an LST, the API includes its staking APY into the pool's base APY.
This is the list of ETH LSTs currently supported by the API: https://github.com/curvefi/curve-api-metadata/blob/main/ethereum-lst-defillama.json
If an ETH LST is missing from this list, feel free to add it: [info on how to do it](https://github.com/curvefi/curve-api-metadata/tree/main?tab=readme-ov-file#files)

# Technical setup

- Environment variables:
  - Dev env variables are injected by dotenv-safe, using `.env.default` as template, and using values from `.env`
  - Prod env variables are injected by ElasticBeanstalk env variables
