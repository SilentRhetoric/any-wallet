/**
 * Helpful resources:
 * https://github.com/perawallet/connect
 */
import { BaseClient } from '../base';
import type {
	Wallet,
	DecodedTransaction,
	DecodedSignedTransaction,
} from '../../types';
import { METADATA } from './constants';
import {
	PeraTransaction,
	PeraWalletClientConstructor,
	InitParams,
	PeraSdk,
	SdkConfig,
} from './types';

import { markRaw } from '@vue/reactivity';
// single imports
import { decodeObj, decodeSignedTransaction, decodeUnsignedTransaction, encodeAddress } from 'algosdk';

export class PeraClient extends BaseClient {
	sdk: PeraSdk;

	constructor({
		sdk: clientSdk, // inited
	}: PeraWalletClientConstructor) {
		super(); // doesnt really do anything
		this.sdk = clientSdk;
	}

	static metadata = METADATA;

	static async init(initParams?: InitParams): Promise<PeraClient | null> {
		console.log(`[${METADATA.id}] init started`);

		try {
			// shim for client that use walletconnect under the hood
			if (typeof window !== 'undefined') {
				(window as any).global = window; // necessary shim for pera. TODO still in new lib version that uses algosdk w buffer shim already done?
			} else {
				console.warn('Using a browser lib not in a browser...');
			}

			let clientSdk: PeraSdk;
			if (initParams && initParams.sdk) {
				clientSdk = initParams.sdk; // already init-ed sdk
			} else {
				// load sdk + init it

				let sdkConfig: SdkConfig;
				const defaultConfig: SdkConfig = {
					shouldShowSignTxnToast: false
				};
				sdkConfig = initParams?.config || defaultConfig;

				let sdkLib = await import('@perawallet/connect');
				let createClientSdk = sdkLib.PeraWalletConnect || sdkLib.default.PeraWalletConnect; // sometimes needs this shim
				// FYI because pera's client is built to cjs, vite's optimize deps helper in the server acts differently than when it builds using rollup. solution: fallback to .default;

				// console.log('createClientSdk', createClientSdk);
				clientSdk = new createClientSdk(sdkConfig);
			}

			clientSdk = markRaw(clientSdk); // vue-r fix

			return new PeraClient({
				sdk: clientSdk,
			});
		} catch (e) {
			console.error(`[${METADATA.id}] Error initializing...`, e);
			return null;
		}
	}

	async connect(onDisconnect: () => void): Promise<Wallet> {
		console.log(`[${METADATA.id}] connect (in class)`);

		const accounts = await this.sdk.connect();

		this.sdk.connector?.on('disconnect', onDisconnect);

		if (accounts.length === 0) {
			throw new Error(`No accounts found for ${METADATA.id}`);
		}

		const mappedAccounts = accounts.map((address: string, index: number) => ({
			name: `Pera Wallet ${index + 1}`,
			address,
			walletId: METADATA.id,
		}));

		return {
			...METADATA,
			accounts: mappedAccounts,
		};
	}

	async reconnect(onDisconnect: () => void) {
		const accounts = await this.sdk.reconnectSession().catch(console.info);
		this.sdk.connector?.on('disconnect', onDisconnect);

		if (!accounts) {
			return null;
		}

		return {
			...METADATA,
			accounts: accounts.map((address: string, index: number) => ({
				name: `Pera Wallet ${index + 1}`,
				address,
				walletId: METADATA.id,
			})),
		};
	}

	async disconnect() {
		await this.sdk.disconnect();
	}

	async signTransactions(
		connectedAccounts: string[],
		transactions: Uint8Array[]
	) {
		const decodedTxns = transactions.map((txn) => {
			return decodeObj(txn);
		}) as Array<DecodedTransaction | DecodedSignedTransaction>;

		// Marshal the transactions, and add the signers property if they shouldn't be signed.
		const txnsToSign = decodedTxns.reduce<PeraTransaction[]>((acc, txn, i) => {
			if (
				!('txn' in txn) &&
				connectedAccounts.includes(encodeAddress(txn['snd']))
			) {
				acc.push({
					txn: decodeUnsignedTransaction(transactions[i]),
				});
			} else {
				acc.push({
					txn: decodeSignedTransaction(transactions[i]).txn,
					signers: [],
				});
			}

			return acc;
		}, []);

		// Sign them with the client.
		const result = await this.sdk.signTransaction([txnsToSign]);

		// Join the newly signed transactions with the original group of transactions.
		const signedTxns = decodedTxns.reduce<Uint8Array[]>((acc, txn, i) => {
			if (!('txn' in txn)) {
				const signedByUser = result.shift();
				signedByUser && acc.push(signedByUser);
			} else {
				acc.push(transactions[i]);
			}

			return acc;
		}, []);

		return signedTxns;
	}

}

export default PeraClient;