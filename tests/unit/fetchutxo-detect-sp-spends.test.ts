import { HDSilentPaymentsWallet } from "../../class/wallets/hd-bip352-wallet";
import { AbstractHDElectrumWallet } from "../../class/wallets/abstract-hd-electrum-wallet";
import * as Electrum from "../../modules/Electrum";

jest.mock("../../modules/Electrum", () => ({
  multiGetUtxoByAddress: jest.fn(),
}));

describe("fetchUtxo detects externally spent SP UTXOs", () => {
  let wallet: HDSilentPaymentsWallet;

  beforeEach(() => {
    jest.resetAllMocks();
    wallet = new HDSilentPaymentsWallet();
    wallet.setSecret(
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    );

    // Mock the parent fetchUtxo so we don't make real network calls for regular addresses
    jest
      .spyOn(AbstractHDElectrumWallet.prototype, "fetchUtxo")
      .mockResolvedValue(undefined);
  });

  function addMockSpUtxo(
    txid: string,
    vout: number,
    address: string,
    isSpent = false,
  ) {
    const utxo = {
      txid,
      vout,
      value: 100000,
      height: 800000,
      address,
      silentPaymentAddress: "sp1...",
      pubKey: "0202...",
      tweak: new Uint8Array(32),
      blockHash: "0000...",
      blockTime: 1000000,
      isSpent,
    };
    (wallet as any).addUTXO(utxo);
  }

  it("marks SP UTXO as spent when its outpoint is absent from a successful Electrum response", async () => {
    addMockSpUtxo("tx1", 0, "bc1p_address_1");

    // Electrum returns empty for the address
    (Electrum.multiGetUtxoByAddress as jest.Mock).mockResolvedValue({
      bc1p_address_1: [],
    });

    await wallet.fetchUtxo();

    expect(wallet._utxo[0].isSpent).toBe(true);
    expect(wallet.getUTXOs()).toHaveLength(0); // getUTXOs hides spent outputs
  });

  it("keeps SP UTXO as unspent when its outpoint is present in Electrum response", async () => {
    addMockSpUtxo("tx2", 0, "bc1p_address_2");

    (Electrum.multiGetUtxoByAddress as jest.Mock).mockResolvedValue({
      bc1p_address_2: [
        {
          txid: "tx2",
          vout: 0,
          value: 100000,
          address: "bc1p_address_2",
          height: 800000,
        },
      ],
    });

    await wallet.fetchUtxo();

    expect(wallet._utxo[0].isSpent).toBe(false);
    expect(wallet.getUTXOs()).toHaveLength(1);
  });

  it("leaves isSpent unchanged on Electrum/network failure", async () => {
    addMockSpUtxo("tx3", 0, "bc1p_address_3");

    // Simulate network error
    (Electrum.multiGetUtxoByAddress as jest.Mock).mockRejectedValue(
      new Error("Network error"),
    );

    await wallet.fetchUtxo();

    // Should remain unspent
    expect(wallet._utxo[0].isSpent).toBe(false);
    expect(wallet.getUTXOs()).toHaveLength(1);
  });

  it("handles multiple SP UTXOs correctly (mixed spent and unspent states)", async () => {
    // Both unspent initially
    addMockSpUtxo("txA", 0, "bc1p_address_4");
    addMockSpUtxo("txB", 1, "bc1p_address_5");

    (Electrum.multiGetUtxoByAddress as jest.Mock).mockImplementation(
      async (addresses: string[]) => {
        return {
          bc1p_address_4: [], // txA is spent
          bc1p_address_5: [
            {
              // txB is unspent
              txid: "txB",
              vout: 1,
              value: 100000,
              address: "bc1p_address_5",
              height: 800000,
            },
          ],
        };
      },
    );

    await wallet.fetchUtxo();

    expect(wallet._utxo.find((u) => u.txid === "txA")!.isSpent).toBe(true);
    expect(wallet._utxo.find((u) => u.txid === "txB")!.isSpent).toBe(false);
  });

  it("retains spent SP UTXOs in _utxo so getTransactions() can see them", async () => {
    addMockSpUtxo("tx6", 0, "bc1p_address_6");

    (Electrum.multiGetUtxoByAddress as jest.Mock).mockResolvedValue({});

    await wallet.fetchUtxo();

    expect(wallet._utxo[0].isSpent).toBe(true);

    // The spent UTXO must still be included in getTransactions
    const transactions = wallet.getTransactions();
    expect(transactions.some((t) => t.txid === "tx6")).toBe(true);
  });

  it("preserves existing regular UTXOs behavior (parent class)", async () => {
    const parentFetchUtxoSpy = jest.spyOn(
      AbstractHDElectrumWallet.prototype,
      "fetchUtxo",
    );

    await wallet.fetchUtxo();

    // Verify it still defers regular UTXO fetching to parent correctly
    expect(parentFetchUtxoSpy).toHaveBeenCalledTimes(1);
  });
});
