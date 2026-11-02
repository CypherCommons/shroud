// Public mainnet block 900000 response; the deployed API omits isSpent.
const indexerRange = {
  transactions: [
    {
      id: '0217dfbcb65bed2d70d60dff296996fdca8846cefbbb7da165f7821762dad8fc',
      blockHeight: 900000,
      blockHash: '000000000000000000010538edbfd2d5b809a33dd83f284aeea41c6d0d96968a',
      blockTime: 1749188499,
      scanTweak: '02e0063d0ce447bba6698ec3201ac796be28f0841181fd32fb3d675f8535715a2e',
      outputs: [
        {
          transactionId: '0217dfbcb65bed2d70d60dff296996fdca8846cefbbb7da165f7821762dad8fc',
          vout: 1,
          pubKey: '73aa22953902d00dabb4ed56d664848ead99cbe38a483aac4be05374a0c169d0',
          value: 546,
        },
      ],
    },
  ],
};

export default indexerRange;
