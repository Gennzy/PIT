"use strict";
// Run locally on your own trusted device. Never use third-party QR services.
const crypto=require('node:crypto'),{encodeBase32}=require('../server/security');
if(process.argv.includes('--help')){console.log('Run npm run mfa:setup -- <admin-email> on your own device. It prints a NEW secret and local otpauth URI; it does not change any account or server.');process.exit(0);}
const email=process.argv[2];
if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){console.error('Usage: npm run mfa:setup -- your-admin-email');process.exit(1);}
const seed=encodeBase32(crypto.randomBytes(20));
const uri='otpauth://totp/'+encodeURIComponent('ПИТ:'+email)+'?secret='+seed+'&issuer='+encodeURIComponent('ПИТ')+'&algorithm=SHA1&digits=6&period=30';
console.log('Private setup output. Do not send this secret or URI to chat, email, screenshots, Git or logs.');
console.log('PLATFORM_TOTP_SECRET='+seed);
console.log('Authenticator manual entry: TOTP / SHA1 / 6 digits / 30 seconds.');
console.log('otpauth URI (use locally only): '+uri);
console.log('This command creates a new seed only. Add it to your authenticator and Vercel server environment before redeploy. Keep a recovery copy in your password manager.');
