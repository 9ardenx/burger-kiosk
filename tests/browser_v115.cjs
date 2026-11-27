process.env.KIOSK_CACHE_TAG='v1.14';
process.env.KIOSK_UI_REVISION='20261128-v115';process.env.KIOSK_QA_DIR='data/qa/v1.15';
for(const feature of ['FRANCHISE','HQ','SUPPLY','WORKSPACE','NOTIFICATIONS','DEVICE_SETUP'])process.env['KIOSK_TEST_'+feature]='1';
require('./browser_v18.cjs');
