/**
 * Global test setup.
 *
 * The shell installs a `t` on every component instance from its i18n plugin,
 * and this extension's templates call it directly. Rather than mount the real
 * plugin — which wants a store, a locale file and a loaded set of translations
 * — tests get a `t` that echoes the key and its arguments, so an assertion can
 * check *which* string was chosen without pinning the English wording.
 */
const { config } = require('@vue/test-utils');

config.global = config.global || {};
config.global.mocks = {
  ...(config.global.mocks || {}),
  t: (key, args) => (args ? `${ key }(${ JSON.stringify(args) })` : key),
};
