import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { config } from '../src/envConfig';
import { verifyDynamicToken, identityFromDynamicProfile } from '../src/services/dynamic';

const environment = '4fc2a73c-1662-45eb-9257-8baa567066a6';
const subject = '11111111-1111-4111-8111-111111111111';
config.dynamicEnvironmentId = environment;
config.dynamicAudience = 'https://app.frenspay.xyz';
const { privateKey, publicKey } = await generateKeyPair('RS256');
const key = async () => publicKey;
const sign = (claims: Record<string, unknown> = {}) => new SignJWT({scope: 'user:basic extra', environment_id: environment, ...claims})
  .setProtectedHeader({alg:'RS256'}).setSubject(subject).setIssuer(`app.dynamicauth.com/${environment}`)
  .setAudience(config.dynamicAudience).setIssuedAt().setExpirationTime('5m').sign(privateKey);
assert.equal(await verifyDynamicToken(await sign(), key), subject);
await assert.rejects(verifyDynamicToken(await sign({scope:'requiresAdditionalAuth'}), key));
await assert.rejects(verifyDynamicToken(await sign({environment_id:'another-environment'}), key));
const wrongAudience = await new SignJWT({scope:'user:basic'}).setProtectedHeader({alg:'RS256'})
  .setSubject(subject).setIssuer(`app.dynamicauth.com/${environment}`).setAudience('https://evil.invalid')
  .setIssuedAt().setExpirationTime('5m').sign(privateKey);
await assert.rejects(verifyDynamicToken(wrongAudience,key));
const expired = await new SignJWT({scope:'user:basic'}).setProtectedHeader({alg:'RS256'})
  .setSubject(subject).setIssuer(`app.dynamicauth.com/${environment}`).setAudience(config.dynamicAudience)
  .setIssuedAt().setExpirationTime(Math.floor(Date.now()/1000)-60).sign(privateKey);
await assert.rejects(verifyDynamicToken(expired,key));
const {publicKey: wrongKey} = await generateKeyPair('RS256');
await assert.rejects(verifyDynamicToken(await sign(),async()=>wrongKey));
const wallet = {format:'blockchain',chain:'eip155',wallet_provider:'embeddedWallet',address:'0x'+'1'.repeat(40)};
const profile = {id:subject,projectEnvironmentId:environment,email:'ALICE@example.test',verifiedCredentials:[{format:'email',email:'alice@example.test'},wallet]};
const identity = identityFromDynamicProfile(profile,subject);
assert.equal(identity.email,'alice@example.test');
assert.equal(identity.walletAddress,wallet.address);
assert.equal(identity.subject,`dynamic:${environment}:${subject}`);
assert.throws(()=>identityFromDynamicProfile({...profile,id:'other'},subject));
assert.throws(()=>identityFromDynamicProfile({...profile,email:'unverified@example.test'},subject));
assert.throws(()=>identityFromDynamicProfile({...profile,verifiedCredentials:[...profile.verifiedCredentials,wallet]},subject));
assert.equal(identityFromDynamicProfile({...profile,verifiedCredentials:[profile.verifiedCredentials[0],{...wallet,wallet_provider:'browserExtension'}]},subject).walletAddress,undefined);
console.log('check-dynamic: signature, expiry, audience, scope, environment, verified email and embedded wallet binding passed (offline)');

const solana={format:'blockchain',chain:'solana',wallet_provider:'embeddedWallet',address:'1'.repeat(32)};
assert.equal(identityFromDynamicProfile({...profile,verifiedCredentials:[...profile.verifiedCredentials,solana]},subject).solanaWalletAddress,solana.address);
assert.throws(()=>identityFromDynamicProfile({...profile,verifiedCredentials:[...profile.verifiedCredentials,solana,solana]},subject));
assert.equal(identityFromDynamicProfile({...profile,verifiedCredentials:[...profile.verifiedCredentials,{...solana,wallet_provider:'browserExtension'}]},subject).solanaWalletAddress,undefined);
