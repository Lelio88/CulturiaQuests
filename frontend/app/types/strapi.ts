// Strapi v5 Generic Response Types

export interface StrapiMedia {
  id: number
  documentId: string
  name: string
  alternativeText?: string | null
  caption?: string | null
  width?: number
  height?: number
  formats?: {
    thumbnail?: StrapiMediaFormat
    small?: StrapiMediaFormat
    medium?: StrapiMediaFormat
    large?: StrapiMediaFormat
  }
  hash: string
  ext: string
  mime: string
  size: number
  url: string
  previewUrl?: string | null
  provider: string
  createdAt?: string
  updatedAt?: string
}

export interface StrapiMediaFormat {
  name: string
  hash: string
  ext: string
  mime: string
  width: number
  height: number
  size: number
  url: string
}

export interface StrapiPagination {
  page: number
  pageSize: number
  pageCount: number
  total: number
}

export interface StrapiMeta {
  pagination?: StrapiPagination
  [key: string]: any
}

export interface StrapiError {
  status: number
  name: string
  message: string
  details?: any
}

export interface StrapiResponse<T> {
  data: T
  meta?: StrapiMeta
  error?: StrapiError
}

export interface StrapiListResponse<T> {
  data: T[]
  meta: StrapiMeta
  error?: StrapiError
}

export interface StrapiSingleResponse<T> {
  data: T
  meta?: StrapiMeta
  error?: StrapiError
}

/**
 * Hub des interfaces de content-types principaux (#43). Permet d'écrire
 * `client<StrapiListResponse<Guild>>(...)` en important tout depuis `~/types/strapi`,
 * et matérialise « types/strapi expose les interfaces des content-types principaux ».
 * Les définitions canoniques restent dans `types/<name>.ts` ; ici on ne fait que ré-exporter.
 */
export type { Guild } from './guild'
export type { Character, CharacterFormData } from './character'
export type { Item } from './item'
export type { Npc } from './npc'
export type { Run } from './run'
export type { Museum } from './museum'
export type { Quest } from './quest'
export type { Friendship, NormalizedFriendship } from './friendship'
export type { Visit } from './visit'
export type { Poi } from './poi'

/** Alias pratique : un « document » Strapi v5 (entité aplatie). */
export type StrapiDocument<T> = T & { id: number; documentId: string }
