export const BIOMES = {
  desert: { name: 'Desert', sky: 0xc6c4b0, fog: 0xc9c1a5, ground: 0xb9a27a, wall: 0xc8af83, accent: 0x8f6650, sun: 0xffe0ae, ambient: 0xe3d9bc },
  snow: { name: 'Snow', sky: 0xa8bdc9, fog: 0xc7d6df, ground: 0xd5e0e3, wall: 0x758b94, accent: 0x425c63, sun: 0xe3f1ff, ambient: 0xd1e5f1 },
  jungle: { name: 'Jungle', sky: 0x9db6ac, fog: 0xabc2ac, ground: 0x66794e, wall: 0x929578, accent: 0x3b6048, sun: 0xffe9b9, ambient: 0xc7dfb7 },
  coast: { name: 'Coastal', sky: 0xa6ccda, fog: 0xc0d4d8, ground: 0xa4a399, wall: 0x8d9ca0, accent: 0x416c84, sun: 0xffefce, ambient: 0xd5e8eb },
  canyon: { name: 'Canyon', sky: 0xc6bcae, fog: 0xcdb099, ground: 0xad7859, wall: 0xb87050, accent: 0x714c3c, sun: 0xffce9c, ambient: 0xe9c5a6 },
  urban: { name: 'Urban', sky: 0xb2bdc5, fog: 0xc4c6c3, ground: 0x93938b, wall: 0xb2aa99, accent: 0x536c76, sun: 0xffe7c7, ambient: 0xd7dce0 },
  industrial: { name: 'Industrial', sky: 0x939fa7, fog: 0xa9b1b0, ground: 0x777b76, wall: 0x929c98, accent: 0xb37e40, sun: 0xffe1b1, ambient: 0xc7d2d0 },
  forest: { name: 'Forest', sky: 0xb2c6c4, fog: 0xb9c9bf, ground: 0x788268, wall: 0x8c826c, accent: 0x405f4b, sun: 0xffe8c1, ambient: 0xd2dfc4 },
} as const;
export type BiomeId = keyof typeof BIOMES;
