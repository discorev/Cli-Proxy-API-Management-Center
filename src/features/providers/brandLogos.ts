import type { ComponentType } from 'react';
import type { IconProps } from '@/components/ui/icons';
import openrouterLogo from '@/assets/icons/openrouter.png';
import claudeLogo from '@/assets/icons/claude.svg';
import codexLogo from '@/assets/icons/codex.svg';
import metaLogo from '@/assets/icons/meta.svg';
import devinLightLogo from '@/assets/icons/devin.svg';
import devinDarkLogo from '@/assets/icons/devin-dark.svg';
import geminiLogo from '@/assets/icons/gemini.svg';
import openaiLightLogo from '@/assets/icons/openai-light.svg';
import openaiDarkLogo from '@/assets/icons/openai-dark.svg';
import vertexLogo from '@/assets/icons/vertex.svg';
import xaiLightLogo from '@/assets/icons/grok.svg';
import xaiDarkLogo from '@/assets/icons/grok-dark.svg';
import kimiLightLogo from '@/assets/icons/kimi-light.svg';
import kimiDarkLogo from '@/assets/icons/kimi-dark.svg';
import type { ProviderBrand } from './types';

export interface ProviderBrandLogo {
  src?: string;
  darkSrc?: string;
  icon?: ComponentType<IconProps>;
  transparent?: boolean;
  themeSurface?: boolean;
  invertOnDark?: boolean;
}

export type ProviderBrandLogoKey = ProviderBrand | 'devin';

export const PROVIDER_LOGOS: Record<ProviderBrandLogoKey, ProviderBrandLogo> = {
  gemini: { src: geminiLogo },
  interactions: { src: geminiLogo },
  claude: { src: claudeLogo },
  codex: { src: codexLogo },
  meta: { src: metaLogo, transparent: true },
  devin: { src: devinLightLogo, darkSrc: devinDarkLogo, transparent: true },
  xai: { src: xaiLightLogo, darkSrc: xaiDarkLogo, transparent: true },
  vertex: { src: vertexLogo },
  openrouter: { src: openrouterLogo, transparent: true },
  openaiCompatibility: { src: openaiLightLogo, darkSrc: openaiDarkLogo, transparent: true },
  kimi: {
    src: kimiDarkLogo,
    darkSrc: kimiLightLogo,
    transparent: true,
    themeSurface: true,
  },
};
