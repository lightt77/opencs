// Keep the supplied files unchanged; Vite copies referenced WAVs into production builds.
const files = import.meta.glob('../assets/sounds/**/*.wav', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
export const AUDIO_ASSETS = Object.fromEntries(Object.entries(files).map(([path, url]) => [path.split('/').at(-1)!.replace(/\.wav$/, ''), url]));
export const ASSET_SHOTS = { ak: 'ak47_fire', m4: 'm4a1_fire', awp: 'awp_fire', pistol: 'usp_fire' };

export const RADIO_LINES = {
  bigVictory: ['i_am_dangerous', 'nice_work_team', 'oh_yea', 'owned', 'we_owned_them', 'well_done', 'yea_baby', 'yesss'],
  closeVictory: ['that_was_the_last_guy', 'that_was_the_last_one'],
  headshot: ['nice_shot2', 'nice', 'nice2'],
  overwhelmed: ['oh_boy', 'oh_boy2', 'theres_too_many', 'theyre_all_over_the_place2', 'theyre_everywhere2', 'whoa', 'yikes'],
  oneLeft: ['one_guy_left', 'theres_one_left'],
  twoLeft: ['two_to_go'],
  friendlyFire: ['ouch', 'ow_its_me', 'ow', 'stop_it'],
  death: ['pain2', 'pain4', 'pain5', 'pain8', 'pain9', 'pain10'],
} as const;
export type RadioEvent = Exclude<keyof typeof RADIO_LINES, 'death'>;
export const radioText = (clip: string) => clip.replace(/2$/, '').replaceAll('_', ' ').replace('theyre', "they’re").replace('theres', "there’s").replace(/^./, c => c.toUpperCase()) + '!';
