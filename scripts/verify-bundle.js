import { verifyBundle } from './bundle.js';

if (process.argv.length !== 3) throw new Error('Usage: node scripts/verify-bundle.js <bundle-directory>');
const { digest } = await verifyBundle(process.argv[2]);
console.log(`Verified bundle.json sha256 ${digest}`);
