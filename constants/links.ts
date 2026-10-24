export const WEBSITE_DOMAIN = 'shroudwallet.com';
export const CONTACT_EMAIL = 'dev@shroudwallet.com';

export const LINKS = {
  email: `mailto:${CONTACT_EMAIL}`,
  github: 'https://github.com/CypherCommons/shroud',
  website: `https://${WEBSITE_DOMAIN}/`,
};

// The self-hosted update server. Also compiled into the native config as `updates.url` (app.json),
// which only a store build can change; the forced-upgrade policy is read from the same host.
export const UPDATE_SERVER_URL = 'https://updates.shroudwallet.com';

// Where "Update required" sends people. Built into the app rather than read from the server's policy,
// so whoever controls that server can't point the button anywhere else.
export const STORE_LINKS = {
  ios: 'https://apps.apple.com/app/id6821538806',
  android: 'https://play.google.com/store/apps/details?id=com.shroudwallet.app',
};
