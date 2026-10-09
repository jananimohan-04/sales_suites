// APP_URL = the HTTPS address where the Argus server is hosted (camera + GPS need HTTPS).
const url = process.env.APP_URL || 'https://CHANGE-ME.example.com';
module.exports = {
  appId: 'ai.axioralabs.argusfield',
  appName: 'Argus Field',
  webDir: 'www',
  server: { url, cleartext: url.startsWith('http://'), androidScheme: 'https' },
  android: { allowMixedContent: false },
};
