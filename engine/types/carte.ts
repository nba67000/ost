// Types de la carte tactique et du royaume.
// Voir RULES §3 (Le monde) et le glossaire.

export type NatureLieu = "place_forte" | "feu_de_guet" | "poste_avance";
export type NatureLien = "route" | "sentier";
export type TerrainId = "crete" | "marais" | "foret" | "plaine" | "delta";
export type Tenu = "royaume" | "horde";

declare const LieuIdBrand: unique symbol;
export type LieuId = string & { readonly [LieuIdBrand]: never };

declare const AbordIdBrand: unique symbol;
export type AbordId = string & { readonly [AbordIdBrand]: never };

declare const SecteurIdBrand: unique symbol;
export type SecteurId = string & { readonly [SecteurIdBrand]: never };

declare const ProvinceIdBrand: unique symbol;
export type ProvinceId = string & { readonly [ProvinceIdBrand]: never };

export interface Abord {
  readonly id: AbordId;
  readonly index_anneau: number;
  readonly fortification: number;
}

export interface Lieu {
  readonly id: LieuId;
  readonly nature: NatureLieu;
  readonly terrain: TerrainId;
  readonly secteur_id: SecteurId | null;
  readonly abords: readonly Abord[];
  readonly tenu_par: Tenu;
}

export interface Lien {
  readonly a: LieuId;
  readonly b: LieuId;
  readonly nature: NatureLien;
}

export interface Province {
  readonly id: ProvinceId;
  readonly lieux: readonly Lieu[];
  readonly liens: readonly Lien[];
  readonly entrees: readonly LieuId[];
  readonly place_forte_id: LieuId;
  readonly fosses: readonly LieuId[];
}
