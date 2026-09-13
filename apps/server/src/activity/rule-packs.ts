import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { type CategoryKind, categories, categoryRules } from '../db/schema.ts';
import { notFound } from '../errors.ts';
import { sweepRules } from './rules.ts';

// Starter rule packs: opt-in sets of category rules for the apps and sites most
// people use, so a new account's first dashboard isn't a wall of uncategorized
// time. Installing one creates (or reuses) its category and writes ordinary
// rules into it — editable, deletable, and evaluated like any other rule.
//
// Everything a pack matches is an exact value, never a fragment, written the
// way the agents actually report it:
//
// - Desktop apps are x-win's `execName`, which differs by platform: the
//   executable's file name on Linux (`code`, `soffice.bin`), its stem without
//   `.exe` on Windows (`Code`, `WINWORD`), and the bundle's folder name on
//   macOS (`Visual Studio Code.app`). Rules are case-insensitive, so `Slack`
//   and `slack` are one entry.
// - The Android agent reports the launcher label as the app (`YouTube`), falls
//   back to the package name when the label won't resolve, and sends the
//   package as the title. So a pack's packages go in twice: into the app list,
//   for the fallback, and as a title rule of their own, which still matches
//   when the label is translated or renamed. The title rule can't misfire on a
//   desktop: no window is titled exactly `com.spotify.music`.
// - Sites are browser hostnames as the desktop agent reads them — lowercased,
//   subdomain and all, so `www.` variants are listed explicitly.
//
// Each list becomes one rule in the `^(a|b|c)$` shape the rules page reads back
// as "is one of", so a pack rule opens in the editor as a plain list rather
// than a regex.

export interface RulePack {
  /** Stable key; also the prefix of every rule tag the pack writes. */
  id: string;
  name: string;
  description: string;
  /**
   * Bumped whenever a list below changes. Reinstalling a newer version
   * rewrites the pack's rules to the new lists; reinstalling the same version
   * changes nothing, so an edit to an installed rule survives it.
   */
  version: number;
  /**
   * The category the rules fill, by name — reused when the user already has
   * it, in which case its color and kind stay the user's.
   */
  category: { name: string; color: string; kind: CategoryKind };
  /** Desktop executable names and Android launcher labels. */
  apps: string[];
  /** Android package names. */
  packages: string[];
  /** Browser hostnames. */
  sites: string[];
}

/** `example.com` and `www.example.com`, the two hosts nearly every site answers on. */
const withWww = (...hosts: string[]): string[] => hosts.flatMap((host) => [host, `www.${host}`]);

export const RULE_PACKS: readonly RulePack[] = [
  {
    id: 'development',
    name: 'Development',
    description: 'Editors, IDEs, terminals and developer tools, plus code hosting and docs sites.',
    version: 1,
    category: { name: 'Development', color: '#3987e5', kind: 'focus' },
    apps: [
      // Editors and IDEs.
      'code',
      'code-oss',
      'codium',
      'Visual Studio Code.app',
      'VSCodium.app',
      'cursor',
      'Cursor.app',
      'zed',
      'zed-editor',
      'Zed.app',
      'devenv',
      'Xcode.app',
      'idea',
      'idea64',
      'IntelliJ IDEA.app',
      'IntelliJ IDEA CE.app',
      'pycharm',
      'pycharm64',
      'PyCharm.app',
      'PyCharm CE.app',
      'webstorm',
      'webstorm64',
      'WebStorm.app',
      'goland',
      'goland64',
      'GoLand.app',
      'clion',
      'clion64',
      'CLion.app',
      'rider',
      'rider64',
      'Rider.app',
      'rustrover',
      'rustrover64',
      'RustRover.app',
      'phpstorm',
      'phpstorm64',
      'PhpStorm.app',
      'studio',
      'studio64',
      'Android Studio.app',
      'sublime_text',
      'Sublime Text.app',
      'gvim',
      'emacs',
      'Emacs.app',
      // Terminals.
      'gnome-terminal-server',
      'ptyxis',
      'konsole',
      'kitty',
      'alacritty',
      'Alacritty.app',
      'wezterm-gui',
      'WezTerm.app',
      'ghostty',
      'Ghostty.app',
      'foot',
      'tilix',
      'xfce4-terminal',
      'WindowsTerminal',
      'Terminal.app',
      'iTerm.app',
      'iTerm2.app',
      'warp',
      'Warp.app',
      // Tools.
      'GitHubDesktop',
      'GitHub Desktop.app',
      'Postman',
      'Postman.app',
      'dbeaver',
      'DBeaver.app',
      'Docker Desktop',
      'Docker Desktop.app',
      // Android labels.
      'Termux',
      'GitHub',
    ],
    packages: ['com.termux', 'com.github.android'],
    sites: [
      ...withWww('github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org'),
      'gist.github.com',
      ...withWww('stackoverflow.com', 'serverfault.com', 'superuser.com'),
      'developer.mozilla.org',
      ...withWww('npmjs.com', 'pypi.org', 'crates.io', 'docs.rs'),
      'pkg.go.dev',
      'localhost',
    ],
  },
  {
    id: 'communication',
    name: 'Communication',
    description:
      'Work chat, email and video calls: Slack, Teams, Zoom, Outlook, Gmail and friends.',
    version: 1,
    category: { name: 'Communication', color: '#199e70', kind: 'work' },
    apps: [
      'slack',
      'Slack.app',
      'Teams',
      'ms-teams',
      'Microsoft Teams.app',
      'Microsoft Teams classic.app',
      'teams-for-linux',
      'zoom',
      'zoom.us.app',
      'OUTLOOK',
      'olk',
      'Microsoft Outlook.app',
      'thunderbird',
      'Thunderbird.app',
      'evolution',
      'geary',
      'Mail.app',
      'mailspring',
      'Mailspring.app',
      'Webex',
      'Webex.app',
      // Android labels.
      // ("Outlook" is OUTLOOK above, case-insensitively.)
      'Gmail',
      'Meet',
      'Zoom Workplace',
    ],
    packages: [
      'com.Slack',
      'com.microsoft.teams',
      'us.zoom.videomeetings',
      'com.google.android.gm',
      'com.microsoft.office.outlook',
      'com.google.android.apps.tachyon',
      'com.cisco.webex.meetings',
    ],
    sites: [
      'app.slack.com',
      'teams.microsoft.com',
      'teams.live.com',
      ...withWww('zoom.us'),
      'app.zoom.us',
      'meet.google.com',
      'mail.google.com',
      'outlook.office.com',
      'outlook.office365.com',
      'outlook.live.com',
      'mail.proton.me',
      'app.fastmail.com',
    ],
  },
  {
    id: 'messaging',
    name: 'Messaging',
    description: 'Personal messengers: Signal, Telegram, WhatsApp, Messages, Element.',
    version: 1,
    category: { name: 'Messaging', color: '#9085e9', kind: 'personal' },
    apps: [
      'signal-desktop',
      'Signal',
      'Signal.app',
      'Telegram',
      'telegram-desktop',
      'Telegram.app',
      'WhatsApp',
      'WhatsApp.app',
      'Messages.app',
      'element-desktop',
      'Element',
      'Element.app',
      // Android labels ("Signal", "Telegram", "WhatsApp" and "Element" are above).
      'Messages',
      'Messenger',
    ],
    packages: [
      'org.thoughtcrime.securesms',
      'org.telegram.messenger',
      'com.whatsapp',
      'com.google.android.apps.messaging',
      'com.facebook.orca',
      'im.vector.app',
    ],
    sites: [
      'web.whatsapp.com',
      'web.telegram.org',
      'messages.google.com',
      'app.element.io',
      ...withWww('messenger.com'),
    ],
  },
  {
    id: 'productivity',
    name: 'Productivity',
    description: 'Documents, spreadsheets, notes, calendars and project tools.',
    version: 1,
    category: { name: 'Productivity', color: '#c98500', kind: 'work' },
    apps: [
      'WINWORD',
      'EXCEL',
      'POWERPNT',
      'ONENOTE',
      'Microsoft Word.app',
      'Microsoft Excel.app',
      'Microsoft PowerPoint.app',
      'Microsoft OneNote.app',
      'soffice.bin',
      'soffice',
      'LibreOffice.app',
      'Pages.app',
      'Numbers.app',
      'Keynote.app',
      'Notes.app',
      'Calendar.app',
      'obsidian',
      'Obsidian.app',
      'notion',
      'Notion.app',
      'Notion Calendar.app',
      'logseq',
      'Logseq.app',
      'joplin',
      'Joplin.app',
      'figma-linux',
      'Figma',
      'Figma.app',
      // Android labels ("Obsidian", "Notion", "Figma", "Excel" and "OneNote"
      // are above, case-insensitively).
      'Word',
      'PowerPoint',
      'Docs',
      'Sheets',
      'Slides',
      'Drive',
      'Calendar',
      'Keep Notes',
    ],
    packages: [
      'com.microsoft.office.word',
      'com.microsoft.office.excel',
      'com.microsoft.office.powerpoint',
      'com.microsoft.office.onenote',
      'com.google.android.apps.docs.editors.docs',
      'com.google.android.apps.docs.editors.sheets',
      'com.google.android.apps.docs.editors.slides',
      'com.google.android.apps.docs',
      'com.google.android.calendar',
      'com.google.android.keep',
      'md.obsidian',
      'notion.id',
    ],
    sites: [
      'docs.google.com',
      'sheets.google.com',
      'slides.google.com',
      'drive.google.com',
      'calendar.google.com',
      'keep.google.com',
      ...withWww('notion.so', 'office.com', 'figma.com', 'miro.com', 'trello.com'),
      'onedrive.live.com',
      'linear.app',
      'app.asana.com',
      'airtable.com',
    ],
  },
  {
    id: 'social',
    name: 'Social',
    description: 'Social networks and forums: Reddit, Instagram, X, TikTok, Discord and more.',
    version: 1,
    category: { name: 'Social', color: '#d55181', kind: 'distracting' },
    apps: [
      'Discord',
      'Discord.app',
      'vesktop',
      // Android labels ("Discord" is above).
      'Instagram',
      'Facebook',
      'X',
      'TikTok',
      'Reddit',
      'Snapchat',
      'Pinterest',
      'LinkedIn',
      'Mastodon',
      'Bluesky',
      'Threads',
    ],
    packages: [
      'com.discord',
      'com.instagram.android',
      'com.facebook.katana',
      'com.twitter.android',
      'com.zhiliaoapp.musically',
      'com.reddit.frontpage',
      'com.snapchat.android',
      'com.pinterest',
      'com.linkedin.android',
      'org.joinmastodon.android',
      'xyz.blueskyweb.app',
      'com.instagram.barcelona',
    ],
    sites: [
      ...withWww(
        'reddit.com',
        'facebook.com',
        'instagram.com',
        'x.com',
        'twitter.com',
        'tiktok.com',
        'linkedin.com',
        'pinterest.com',
        'threads.net',
        'threads.com',
        'tumblr.com',
      ),
      'old.reddit.com',
      'm.facebook.com',
      'mobile.twitter.com',
      'bsky.app',
      'mastodon.social',
      'discord.com',
      'news.ycombinator.com',
    ],
  },
  {
    id: 'entertainment',
    name: 'Entertainment',
    description: 'Video, streaming and music: YouTube, Netflix, Twitch, Spotify, media players.',
    version: 1,
    category: { name: 'Entertainment', color: '#d95926', kind: 'distracting' },
    apps: [
      'spotify',
      'Spotify.app',
      'vlc',
      'VLC.app',
      'mpv',
      'mpv.app',
      'IINA.app',
      'celluloid',
      'totem',
      'Music.app',
      'TV.app',
      'Podcasts.app',
      'Plex',
      'Plex.app',
      'stremio',
      'Stremio.app',
      // Android labels ("Spotify" and "Plex" are above).
      'YouTube',
      'YouTube Music',
      'Netflix',
      'Prime Video',
      'Disney+',
      'Twitch',
      'Max',
    ],
    packages: [
      'com.google.android.youtube',
      'com.google.android.apps.youtube.music',
      'com.netflix.mediaclient',
      'com.spotify.music',
      'com.amazon.avod.thirdpartyclient',
      'com.disney.disneyplus',
      'tv.twitch.android.app',
      'com.plexapp.android',
      'com.wbd.stream',
    ],
    sites: [
      ...withWww(
        'youtube.com',
        'netflix.com',
        'twitch.tv',
        'primevideo.com',
        'disneyplus.com',
        'hulu.com',
        'max.com',
        'crunchyroll.com',
        'vimeo.com',
      ),
      'm.youtube.com',
      'music.youtube.com',
      'open.spotify.com',
    ],
  },
  {
    id: 'gaming',
    name: 'Gaming',
    description: 'Game launchers and stores: Steam, Epic, Battle.net, GOG, Lutris, Heroic.',
    version: 1,
    category: { name: 'Gaming', color: '#008300', kind: 'personal' },
    apps: [
      'steam',
      // Steam's own windows belong to its embedded browser process.
      'steamwebhelper',
      'Steam.app',
      'EpicGamesLauncher',
      'Epic Games Launcher.app',
      'Battle.net',
      'Battle.net.app',
      'GalaxyClient',
      'GOG Galaxy.app',
      'lutris',
      'heroic',
      'Heroic.app',
      'RiotClientServices',
      // Android labels ("Steam" is covered above, case-insensitively).
      'Minecraft',
      'Roblox',
    ],
    packages: [
      'com.valvesoftware.android.steam.community',
      'com.mojang.minecraftpe',
      'com.roblox.client',
    ],
    sites: [
      'store.steampowered.com',
      'steamcommunity.com',
      'store.epicgames.com',
      ...withWww('chess.com', 'roblox.com'),
      'lichess.org',
      'itch.io',
    ],
  },
];

// --- installing --------------------------------------------------------------

const META = /[.*+?^${}()|[\]\\]/g;

/**
 * The rules page's "is one of" pattern (apps/web lib/pattern.ts toPattern), so
 * the editor reads a pack rule back as a list instead of a raw regex.
 */
export const oneOf = (values: string[]): string =>
  `^(${values.map((value) => value.replace(META, '\\$&')).join('|')})$`;

/** A rule a pack writes: its tag, and the one pattern it matches on. */
export interface PackRule {
  pack: string;
  appPattern: string | null;
  titlePattern: string | null;
  contextPattern: string | null;
}

/** The rules a pack installs, one per non-empty list. */
export function packRules(pack: RulePack): PackRule[] {
  const rules: PackRule[] = [];
  const add = (
    slot: string,
    field: 'appPattern' | 'titlePattern' | 'contextPattern',
    values: string[],
  ) => {
    if (values.length === 0) return;
    rules.push({
      pack: `${pack.id}/${slot}`,
      appPattern: null,
      titlePattern: null,
      contextPattern: null,
      [field]: oneOf(values),
    });
  };
  // Packages join the app list for a label that didn't resolve.
  add('apps', 'appPattern', [...pack.apps, ...pack.packages]);
  add('packages', 'titlePattern', pack.packages);
  add('sites', 'contextPattern', pack.sites);
  return rules;
}

export const findRulePack = (id: string): RulePack | undefined =>
  RULE_PACKS.find((pack) => pack.id === id);

/** The tag prefix every rule of a pack carries. */
const tagPrefix = (pack: RulePack) => `${pack.id}/%`;

/**
 * Per pack id, the newest version the user has installed — read off the tags of
 * the rules still standing, so a pack whose rules were all deleted reads as not
 * installed, which is what it is.
 */
export async function installedPackVersions(db: Db, userId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ pack: categoryRules.pack, version: categoryRules.packVersion })
    .from(categoryRules)
    .where(and(eq(categoryRules.userId, userId), sql`${categoryRules.pack} is not null`));
  const versions = new Map<string, number>();
  for (const row of rows) {
    const id = row.pack!.split('/')[0]!;
    versions.set(id, Math.max(versions.get(id) ?? 0, row.version ?? 0));
  }
  return versions;
}

export interface PackInstall {
  pack: RulePack;
  categoryId: string;
  /** Rules written that weren't there. */
  added: number;
  /** Rules rewritten from an older version of the pack. */
  updated: number;
  /** Activities the follow-up sweep moved. */
  categorized: number;
}

/**
 * Installs a pack for a user, or brings an installed one up to date.
 *
 * Idempotent, slot by slot:
 * - A slot with no rule gets one — which also brings back a pack rule the user
 *   deleted, since installing is asking for the pack's rules.
 * - A slot whose rule an older version wrote is rewritten to this version's
 *   list. Its category and priority stay as the user left them.
 * - A slot already at this version is left exactly as it is, edits and all.
 *
 * The category is the one the pack's surviving rules already point at, else
 * the user's category of the pack's name, else a new one.
 *
 * Then the rules are swept over history, the same sweep applyCategoryRules
 * runs: the point of installing a pack is the uncategorized time already on
 * the dashboard, not only the time still to come.
 */
export async function installRulePack(db: Db, userId: string, id: string): Promise<PackInstall> {
  const pack = findRulePack(id);
  if (!pack) throw notFound('Unknown rule pack');

  const result = await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(categoryRules)
      .where(
        and(eq(categoryRules.userId, userId), sql`${categoryRules.pack} like ${tagPrefix(pack)}`),
      );

    let categoryId = existing[0]?.categoryId;
    if (!categoryId) {
      const [named] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.userId, userId), eq(categories.name, pack.category.name)));
      categoryId =
        named?.id ??
        (
          await tx
            .insert(categories)
            .values({
              id: crypto.randomUUID(),
              userId,
              name: pack.category.name,
              color: pack.category.color,
              kind: pack.category.kind,
            })
            // A category of this name created between the select and here.
            .onConflictDoUpdate({
              target: [categories.userId, categories.name],
              set: { name: pack.category.name },
            })
            .returning({ id: categories.id })
        )[0]!.id;
    }

    let added = 0;
    let updated = 0;
    for (const rule of packRules(pack)) {
      const patterns = {
        appPattern: rule.appPattern,
        titlePattern: rule.titlePattern,
        contextPattern: rule.contextPattern,
      };
      const current = existing.find((row) => row.pack === rule.pack);
      if (current) {
        if ((current.packVersion ?? 0) >= pack.version) continue;
        await tx
          .update(categoryRules)
          .set({ ...patterns, packVersion: pack.version })
          .where(eq(categoryRules.id, current.id));
        updated += 1;
        continue;
      }
      // The same rule already written by hand, or restored untagged from a
      // bundle: adopt it rather than write its twin.
      const [twin] = await tx
        .select({ id: categoryRules.id })
        .from(categoryRules)
        .where(
          and(
            eq(categoryRules.userId, userId),
            eq(categoryRules.categoryId, categoryId),
            isNull(categoryRules.pack),
            sql`${categoryRules.appPattern} is not distinct from ${rule.appPattern}`,
            sql`${categoryRules.titlePattern} is not distinct from ${rule.titlePattern}`,
            sql`${categoryRules.contextPattern} is not distinct from ${rule.contextPattern}`,
          ),
        )
        .limit(1);
      if (twin) {
        await tx
          .update(categoryRules)
          .set({ pack: rule.pack, packVersion: pack.version })
          .where(eq(categoryRules.id, twin.id));
        continue;
      }
      const inserted = await tx
        .insert(categoryRules)
        .values({
          id: crypto.randomUUID(),
          userId,
          categoryId,
          ...patterns,
          pack: rule.pack,
          packVersion: pack.version,
        })
        // A concurrent install of the same pack got there first.
        .onConflictDoNothing({ target: [categoryRules.userId, categoryRules.pack] })
        .returning({ id: categoryRules.id });
      added += inserted.length;
    }
    return { categoryId, added, updated };
  });

  // Outside the transaction: the sweep pages through the whole history in
  // transactions of its own, and rules it can see are what it applies.
  const categorized = await sweepRules(db, userId);
  return { pack, ...result, categorized };
}
