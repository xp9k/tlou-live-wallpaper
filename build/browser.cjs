const fs=require('node:fs');
const path=require('node:path');
const local=path.resolve(__dirname,'../.cache/browsers');
if(!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(local)) process.env.PLAYWRIGHT_BROWSERS_PATH=local;
const {chromium}=require('playwright');
const installed=chromium.executablePath();
module.exports={headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE || (fs.existsSync(installed) ? installed : undefined)};
