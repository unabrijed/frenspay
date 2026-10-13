import 'fast-text-encoding';
import {Buffer} from 'buffer';
import {getRandomValues,randomUUID} from 'expo-crypto';
if(!global.crypto)global.crypto={};
if(!global.crypto.getRandomValues)global.crypto.getRandomValues=getRandomValues;
if(!global.crypto.randomUUID)global.crypto.randomUUID=randomUUID;
global.Buffer=Buffer;
