import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  browserFamily,
  buildReport,
  DEFAULT_PORT,
  eventsUrl,
  originOf,
  parsePort,
} from './report.js';

const tab = (over = {}) => ({
  url: 'https://github.com/cubicecho/eunomia/pulls?token=secret#x',
  title: 'Pull requests',
  incognito: false,
  ...over,
});

describe('buildReport', () => {
  it('sends the origin and title of the focused tab, never the path or query', () => {
    expect(buildReport(tab(), { focused: true, sendTitles: true, browser: 'firefox' })).toEqual({
      kind: 'browser',
      browser: 'firefox',
      focused: true,
      incognito: false,
      url: 'https://github.com/',
      title: 'Pull requests',
    });
  });

  it('leaves the title out when titles are off', () => {
    expect(
      buildReport(tab(), { focused: true, sendTitles: false, browser: 'chrome' }).title,
    ).toBeNull();
  });

  it('sends nothing about a private tab but the fact that it is private', () => {
    expect(
      buildReport(tab({ incognito: true }), { focused: true, sendTitles: true, browser: 'chrome' }),
    ).toEqual({
      kind: 'browser',
      browser: 'chrome',
      focused: true,
      incognito: true,
    });
  });

  it('says the browser is not in front when no window has focus or no tab is active', () => {
    expect(buildReport(tab(), { focused: false, sendTitles: true, browser: 'chrome' })).toEqual({
      kind: 'browser',
      browser: 'chrome',
      focused: false,
    });
    expect(
      buildReport(undefined, { focused: true, sendTitles: true, browser: 'chrome' }).focused,
    ).toBe(false);
  });

  it('has no site for pages that are not on the web', () => {
    for (const url of [
      'about:newtab',
      'chrome://settings',
      'file:///home/me/a.pdf',
      'moz-extension://x/y',
      undefined,
    ]) {
      expect(
        buildReport(tab({ url }), { focused: true, sendTitles: true, browser: 'x' }).url,
      ).toBeNull();
    }
  });
});

describe('helpers', () => {
  it('keeps the port in an origin, and drops credentials', () => {
    expect(originOf('http://user:pw@localhost:3000/a')).toBe('http://localhost:3000/');
  });

  it('names the browser the way its executable is named', () => {
    expect(browserFamily({ runtime: { getBrowserInfo: () => {} } })).toBe('firefox');
    expect(browserFamily({ runtime: {}, navigator: { brave: {} } })).toBe('brave');
    const brands = (...names) => ({
      runtime: {},
      navigator: { userAgentData: { brands: names.map((brand) => ({ brand })) } },
    });
    expect(browserFamily(brands('Chromium', 'Microsoft Edge'))).toBe('msedge');
    expect(browserFamily(brands('Chromium', 'Google Chrome'))).toBe('chrome');
    expect(browserFamily(brands('Chromium'))).toBe('chromium');
    expect(browserFamily({})).toBe('chrome');
  });

  it('falls back to the default port for anything that is not one', () => {
    expect(parsePort('5601')).toBe(5601);
    expect(parsePort('')).toBe(DEFAULT_PORT);
    expect(parsePort('70000')).toBe(DEFAULT_PORT);
    expect(eventsUrl(5600)).toBe('http://127.0.0.1:5600/v1/events');
  });
});

describe('manifest', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

  it('loads in both Chromium (service_worker) and Firefox (scripts)', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background.service_worker).toBe('src/background.js');
    expect(manifest.background.scripts).toEqual(['src/background.js']);
    expect(manifest.browser_specific_settings.gecko.id).toMatch(/@/);
  });

  it('can reach the agent on loopback and nothing else', () => {
    expect(manifest.host_permissions).toEqual(['http://127.0.0.1/*']);
  });
});
