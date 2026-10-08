import { RENEWAL_HERO_CHUNK_01 } from './renewal-hero-chunk-01.mjs';
import { RENEWAL_HERO_CHUNK_02 } from './renewal-hero-chunk-02.mjs';
import { RENEWAL_HERO_CHUNK_03 } from './renewal-hero-chunk-03.mjs';
import { RENEWAL_HERO_CHUNK_04 } from './renewal-hero-chunk-04.mjs';
import { RENEWAL_HERO_CHUNK_05 } from './renewal-hero-chunk-05.mjs';
import { RENEWAL_HERO_CHUNK_06 } from './renewal-hero-chunk-06.mjs';
import { RENEWAL_HERO_CHUNK_07 } from './renewal-hero-chunk-07.mjs';

export const RENEWAL_HERO_BASE64 = [
  RENEWAL_HERO_CHUNK_01,
  RENEWAL_HERO_CHUNK_02,
  RENEWAL_HERO_CHUNK_03,
  RENEWAL_HERO_CHUNK_04,
  RENEWAL_HERO_CHUNK_05,
  RENEWAL_HERO_CHUNK_06,
  RENEWAL_HERO_CHUNK_07
].join('').replace(/\s+/g, '');
