import { decodeFunctionData, parseAbi, parseEventLogs } from 'viem';
const entryAbi = parseAbi([
  'function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,uint256 callGasLimit,uint256 verificationGasLimit,uint256 preVerificationGas,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,bytes paymasterAndData,bytes signature)[] ops,address beneficiary)',
  'function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops,address beneficiary)',
]);
const executeAbi = parseAbi(['function execute(address dest,uint256 value,bytes data)', 'function execute(bytes32 mode,bytes executionCalldata)']);
const eventAbi = parseAbi(['event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)']);
const entryPoints = new Set(['0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789', '0x0000000071727de22e5e9d8baf0edac6f37da032']);
/** Unknown smart-account envelopes go to review; arbitrary calldata substrings are not proof. */
export function verifySponsoredReceipt(tx: {to: string|null;input: `0x${string}`}, logs: any[], sender: string, target: string, commitment: string): boolean {
  try {
    if (!tx.to || !entryPoints.has(tx.to.toLowerCase())) return false;
    const successful = parseEventLogs({ abi: eventAbi, logs }).some(e => e.address.toLowerCase() === tx.to!.toLowerCase() && e.args.sender.toLowerCase() === sender.toLowerCase() && e.args.success);
    if (!successful) return false;
    const decoded = decodeFunctionData({ abi: entryAbi, data: tx.input });
    const ops = decoded.args[0].filter(op => op.sender.toLowerCase() === sender.toLowerCase());
    if (ops.length !== 1) return false;
    const call = decodeFunctionData({ abi: executeAbi, data: ops[0].callData });
    if (call.args.length === 3)
      return call.args[0].toLowerCase() === target.toLowerCase() && call.args[1] === 0n && call.args[2] === commitment;
    return call.args[0] === '0x' + '00'.repeat(32) &&
      call.args[1].toLowerCase() === ('0x' + target.slice(2) + '00'.repeat(32) + commitment.slice(2)).toLowerCase();
  } catch { return false; }
}
