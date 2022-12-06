import React, { useEffect, useState } from 'react';

import { LoadingButton } from '@mui/lab';
import { Alert, Typography } from '@mui/material';
import Grid from '@mui/material/Grid';
import { Box } from '@mui/system';
import { useWeb3React } from '@web3-react/core';
import { useForm } from 'react-hook-form';
import web3 from 'web3';

import ERC20_ABI from 'abis/ERC20Abi.json';
import NOTARIZER_ABI from 'abis/NotarizerAbi.json';
import TOKEN_MANAGER_ABI from 'abis/TokenManagerAbi.json';
import VERUS_BRIDGE_MASTER_ABI from 'abis/VerusBridgeMasterAbi.json';
import VERUS_UPGRADE_ABI from 'abis/VerusUpgradeAbi.json';
import {
  BRIDGE_MASTER_ADD,
  GLOBAL_ADDRESS,
  ETH_FEES,
  UPGRADE_ADD,
  TOKEN_MANAGER_ADD
} from 'constants/contractAddress';
import useContract from 'hooks/useContract';
import { getContract } from 'utils/contract';
import { getConfigOptions } from 'utils/txConfig';

import { useToast } from '../Toast/ToastProvider';
import AddressField from './AddressField';
import AmountField from './AmountField';
import DestinationField from './DestinationField';
import TokenField from './TokenField';

const maxGas = 6000000;
const maxGas2 = 100000;
const FLAG_DEST_GATEWAY = 128;
const BRIDGE_STORAGE_ENUM = 8;
const NOTARIZER_ENUM = 4;
const { GAS_TRANSACTIONIMPORTFEE, MINIMUM_GAS_PRICE_WEI } = ETH_FEES;

export default function TransactionForm() {
  const [poolAvailable, setPoolAvailable] = useState(false);
  const [isTxPending, setIsTxPending] = useState(false);
  const [alert, setAlert] = useState(null);
  const [verusTestHeight, setVerusTestHeight] = useState(null);
  const [verusTokens, setVerusTokens] = useState(['']);
  const [GASPrice, setGASPrice] = useState("");
  const { addToast } = useToast();
  const { account, library } = useWeb3React();
  const verusBridgeMasterContract = useContract(BRIDGE_MASTER_ADD, VERUS_BRIDGE_MASTER_ABI);
  const verusUpgradeContract = useContract(UPGRADE_ADD, VERUS_UPGRADE_ABI);
  const tokenManagerContract = useContract(TOKEN_MANAGER_ADD, TOKEN_MANAGER_ABI);

  const { handleSubmit, control, watch } = useForm({
    mode: 'all'
  });
  const selectedToken = watch('token');
  const address = watch('address');

  const getArticlesFromApi = async () => {

    const latestBlock = await library.getBlockNumber();
    const block = await library.getBlock(latestBlock - 10);
    const transaction = await library.getTransaction(block.transactions[Math.ceil(block.transactions.length / 2)]);

    // eslint-disable-next-line
    const gasPriceInWei = web3.utils.hexToNumber(transaction.gasPrice._hex);
    const gasPriceInWeiBN = new web3.utils.BN(gasPriceInWei);
    const gasPriceInWEIString = gasPriceInWeiBN.toString();
    // eslint-disable-next-line no-console
    console.log("gasprice ", gasPriceInWEIString);
    const gasPricePlusBuffer = gasPriceInWeiBN.mul(new web3.utils.BN('12')).div(new web3.utils.BN('10')) // add 20%

    if (gasPricePlusBuffer.lt(new web3.utils.BN(MINIMUM_GAS_PRICE_WEI))) {

      const minimumSATSFee = new web3.utils.BN(GAS_TRANSACTIONIMPORTFEE).toString();
      const minimumWEIFee = new web3.utils.BN(MINIMUM_GAS_PRICE_WEI).mul(new web3.utils.BN(GAS_TRANSACTIONIMPORTFEE)).toString();
      return { SATSCOST: minimumSATSFee, WEICOST: minimumWEIFee };
    }

    const gasInSats = gasPricePlusBuffer.mul(new web3.utils.BN(GAS_TRANSACTIONIMPORTFEE)).div(new web3.utils.BN("10000000000")).toString();  // divide WEI by 10,000,000,000 to get into sats
    const weiPrice = gasPricePlusBuffer.mul(new web3.utils.BN(GAS_TRANSACTIONIMPORTFEE)).toString();

    return { SATSCOST: gasInSats, WEICOST: weiPrice };

  };


  const checkBridgeLaunched = async (contract) => {
    try {
      const notarizerAddress = await verusUpgradeContract.contracts(NOTARIZER_ENUM);
      const notarizerContract = getContract(notarizerAddress, NOTARIZER_ABI, library, account);
      const GASPrices = await getArticlesFromApi();
      const pool = await contract.isPoolAvailable();

      setGASPrice(GASPrices);

      setPoolAvailable(pool);
      const forksData = await notarizerContract.bestForks(0);
      const heightPos = 202;
      const heightHex = parseInt(`0x${forksData.substring(heightPos, heightPos + 4)}`, 16);
      setVerusTestHeight(heightHex || 1);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(err)
      setVerusTestHeight(1);
    }
  }

  const getTokens = async () => {

    const tokens = await tokenManagerContract.getTokenList();
    const TOKEN_OPTIONS = tokens.map(e => ({ label: e.name, value: e.ticker, iaddress: e.iaddress, erc20address: e.erc20ContractAddress }))
    return TOKEN_OPTIONS
  }

  useEffect(() => {
    if (verusBridgeMasterContract && account && verusUpgradeContract) {
      checkBridgeLaunched(verusBridgeMasterContract);
    }
  }, [verusBridgeMasterContract, verusUpgradeContract, account])

  useEffect(async () => {
    if (tokenManagerContract && account) {
      const tokens = await getTokens();
      setVerusTokens(tokens);
    }
  }, [tokenManagerContract, account])

  const authoriseOneTokenAmount = async (token, amount) => {
    setAlert(`Metamask will now pop up to allow the Verus Bridge Contract to spend ${amount}(${token.name}) from your Goerli balance.`);

    const tokenERC = verusTokens.find(add => add.iaddress === token.value).erc20address;
    const tokenInstContract = getContract(tokenERC, ERC20_ABI, library, account)
    const decimals = web3.utils.toBN(await tokenInstContract.decimals());

    const ten = new web3.utils.BN(10);
    const base = ten.pow(new web3.utils.BN(decimals));
    const comps = amount.split('.');
    if (comps.length > 2) { throw new Error('Too many decimal points'); }

    let whole = comps[0];
    let fraction = comps[1];

    if (!whole) { whole = '0'; }
    if (!fraction) { fraction = '0'; }
    if (fraction.length > decimals) {
      throw new Error('Too many decimal places');
    }

    while (fraction.length < decimals) {
      fraction += '0';
    }

    whole = new web3.utils.BN(whole);
    fraction = new web3.utils.BN(fraction);
    const bigAmount = (whole.mul(base)).add(fraction);

    const bridgeStorageAddress = await verusUpgradeContract.contracts(BRIDGE_STORAGE_ENUM);

    await tokenInstContract.approve(bridgeStorageAddress, bigAmount.toString(), { from: account, gasLimit: maxGas2 })

    setAlert(`
      Your Goerli account has authorised the bridge to spend ${token.name} token, the amount: ${amount}. 
      \n Next, after this window please check the amount in Meta mask is what you wish to send.`
    );
  }

  const onSubmit = async (values) => {
    const { token, amount } = values;
    setAlert(null);
    setIsTxPending(true);

    try {
      if (token?.value !== GLOBAL_ADDRESS.ETH) {
        await authoriseOneTokenAmount(token, amount);
      }
      const result = getConfigOptions({ ...values, poolAvailable, GASPrice });

      if (result) {
        const { flagvalue, feecurrency, fees, destinationtype, destinationaddress, destinationcurrency, secondreserveid } = result;
        const verusAmount = (amount * 100000000);
        const currencyIaddress = token.value;
        const CReserveTransfer = {
          version: 1,
          currencyvalue: { currency: currencyIaddress, amount: verusAmount.toFixed(0) }, // currency sending from ethereum
          flags: flagvalue,
          feecurrencyid: feecurrency, // fee is vrsctest pre bridge launch, veth or others post.
          fees,
          destination: { destinationtype, destinationaddress }, // destination address currecny is going to
          destcurrencyid: destinationcurrency,   // destination currency is vrsc on direct. bridge.veth on bounceback
          destsystemid: "0x0000000000000000000000000000000000000000",     // destination system not used 
          secondreserveid    // used as return currency type on bounce back
        }

        if (currencyIaddress === secondreserveid) {
          throw new Error('Cannot bounceback to same currency');
        }

        const { BN } = web3.utils;
        let MetaMaskFee = new BN(web3.utils.toWei(ETH_FEES.ETH, 'ether'));
        // eslint-disable-next-line
        if (destinationtype & FLAG_DEST_GATEWAY) {
          MetaMaskFee = MetaMaskFee.add(new BN(GASPrice.WEICOST)); // bounceback fee
        }

        if (token.value === GLOBAL_ADDRESS.ETH) {
          MetaMaskFee = MetaMaskFee.add(new BN(web3.utils.toWei(amount, 'ether')));
        }

        const txResult = await verusBridgeMasterContract.export(
          CReserveTransfer,
          { from: account, gasLimit: maxGas, value: MetaMaskFee.toString() }
        );
        await txResult.wait();

        addToast({ type: "success", description: 'Transaction Success!' });
        setAlert(null);
        setIsTxPending(false);
      } else {
        throw new Error('something went wrong');
      }
    } catch (error) {
      if (error.message) {
        addToast({ type: "error", description: error.message })
      } else {
        addToast({ type: "error", description: 'Transaction Failed!' })
      }
      setAlert(null);
      setIsTxPending(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit(onSubmit)}>
        {alert &&
          <Alert severity="warning" sx={{ mb: 3 }}>
            <Typography>
              {alert}
            </Typography>
          </Alert>
        }
        {account ? (
          <Alert severity="info" sx={{ mb: 3 }}>
            <Typography>
              {poolAvailable ? "Bridge.veth currency Launched." : "Bridge.veth currency not launched."}
            </Typography>
            <Typography>
              Last Confirmed VerusTest height: <b>{verusTestHeight}</b>
            </Typography>
          </Alert>
        ) :
          (<Alert severity="info" sx={{ mb: 3 }}>
            <Typography>
              <b>Wallet not connected</b>
            </Typography>
          </Alert>)
        }
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <AddressField
              control={control}
            />
          </Grid>
          <Grid item xs={12}>
            {verusTestHeight > 0 && (<TokenField
              control={control}
              poolAvailable={poolAvailable}
            />)}
          </Grid>
          <Grid item xs={12}>
            <DestinationField
              control={control}
              poolAvailable={poolAvailable}
              address={address}
              selectedToken={selectedToken}
            />
          </Grid>
          <Grid item xs={12}>
            <AmountField
              control={control}
              selectedToken={selectedToken}
            />
          </Grid>
          <Box mt="30px" textAlign="center" width="100%">
            <LoadingButton loading={isTxPending} disabled={!verusTokens} type="submit" color="primary" variant="contained">Send</LoadingButton>
          </Box>
        </Grid>
      </form>
    </>
  );
}