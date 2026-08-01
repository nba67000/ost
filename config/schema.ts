// Forme attendue de config/balance.json.
// Interface Balance : contrat de type au compile-time.
// SCHEMA : descripteur runtime utilisé par le loader pour valider chaque clé.
//
// Toute constante ajoutée dans balance.json doit apparaître ici sous les deux formes,
// sinon le loader la rejettera silencieusement (pas trouvée dans SCHEMA) ou le compilo
// pestera (pas trouvée dans Balance).

export interface Balance {
  readonly temps: {
    readonly duree_lune_jours: number;
    readonly actes_par_lune: number;
    readonly heure_assaut: string;
    readonly verrouillage_ordres_minutes_avant: number;
    readonly entre_deux_lunes_jours: number;
    readonly bonus_preparation_verrouillage_matinal: number;
    readonly malus_fatigue_reordonnancement_tardif: number;
    readonly jour_premier_assaut: number;
  };
  readonly carte: {
    readonly lieux_par_joueur_actif: number;
    readonly lieux_min: number;
    readonly lieux_max: number;
    readonly profondeur_entree_place_forte_min: number;
    readonly profondeur_entree_place_forte_max: number;
    readonly goulots_min: number;
    readonly goulots_max: number;
    readonly entrees_min: number;
    readonly entrees_max: number;
    readonly abords: {
      readonly feu_de_guet: number;
      readonly poste_avance: number;
      readonly fosse: number;
    };
  };
  readonly grades: {
    readonly seuils_effectif: Record<"caporal" | "sergent" | "capitaine" | "general", number>;
    readonly conditions_reserve: Record<"caporal" | "sergent" | "capitaine" | "general", number>;
    readonly coordination: Record<
      "recrue" | "soldat" | "caporal" | "sergent" | "capitaine" | "general",
      number
    >;
    readonly mandat_jours: number;
    readonly interim_apres_heures_inactivite: number;
    readonly decroissance_si_non_exerce_une_lune: number;
  };
  readonly combat: {
    readonly rounds_max: number;
    readonly taux_pertes_par_round: number;
    readonly seuil_rupture_abord: number;
    readonly malus_flanc_apres_rupture: number;
    readonly clamp_force_min: number;
    readonly clamp_force_max: number;
    readonly abords_place_forte_min: number;
    readonly abords_place_forte_max: number;
    readonly matrice_posture: Readonly<Record<string, Readonly<Record<string, number>>>>;
    readonly modificateurs: {
      readonly fortification_par_niveau: number;
      readonly garnison_affamee: number;
      readonly fatigue_combat_veille: number;
      readonly usure_equipement_min: number;
    };
  };
  readonly horde: {
    readonly exposant_adaptation_population: number;
    readonly fenetre_mesure_activite_jours: number;
    readonly plancher_intensite: number;
    readonly plafond_intensite_par_front: number;
    readonly production_par_fosse_par_jour: number;
    readonly doctrines_total: number;
    readonly doctrines_par_lune: number;
    readonly diviseur_fronts: number;
    readonly multiplicateur_offensive: number;
    readonly part_goulot: number;
  };
  readonly renseignement: {
    readonly delai_patrouille_heures: number;
    readonly delai_eclaireur_jours: number;
    readonly delai_espion_jours: number;
    readonly questions_espion_par_cycle: number;
  };
  readonly blessures: {
    readonly duree_heures: Record<"legere" | "serieuse" | "grave", number>;
    readonly escalade_facteur: number;
    readonly fenetre_escalade_heures: number;
    readonly places_eleves_par_blesse: number;
    readonly plafond_piste_arriere_par_lune: number;
    readonly part_des_pertes: number;
    readonly seuils_severite: Record<"serieuse" | "grave", number>;
  };
  readonly economie: {
    readonly rendement_auto_production_veteran: number;
    readonly usure_batailles_neuf: number;
    readonly usure_batailles_apres_demobilisation: number;
    readonly cout_reparation_ratio: number;
    readonly matieres_par_province_tenue_par_jour: number;
    readonly rendement_atelier: number;
  };
  readonly progression: {
    readonly multiplicateur_besoin_min: number;
    readonly multiplicateur_besoin_max: number;
    readonly bonus_ordre_accompli: number;
    readonly satiete_quotidienne_par_activite: number;
    readonly jours_cible_acces_marche: number;
    readonly ratio_paliers: number;
    readonly base_evenement: number;
  };
  readonly terrain: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly ravitaillement: {
    readonly capacite_max: Record<"place_forte" | "feu_de_guet" | "poste_avance", number>;
    readonly consommation_par_jour: number;
    readonly consommation_assaut: number;
    readonly recharge_par_jour: number;
    readonly seuil_affamee_jours: number;
  };
  readonly compression: {
    readonly max_par_lune: number;
  };
  readonly generation: {
    readonly essais_max: number;
    readonly part_terrain_dominant: number;
    readonly cycles_min: number;
    readonly cycles_max: number;
    readonly fosses_min: number;
    readonly fosses_max: number;
  };
  readonly usure: {
    readonly par_assaut: number;
    readonly penalite_abord_rompu: number;
  };
}

// Descripteur runtime. Feuilles : "number" | "string" | "object" (objet non recursé).
export type SchemaFeuille = "number" | "string" | "object";
export interface SchemaNoeud {
  readonly [key: string]: SchemaFeuille | SchemaNoeud;
}

export const SCHEMA: SchemaNoeud = {
  temps: {
    duree_lune_jours: "number",
    actes_par_lune: "number",
    heure_assaut: "string",
    verrouillage_ordres_minutes_avant: "number",
    entre_deux_lunes_jours: "number",
    bonus_preparation_verrouillage_matinal: "number",
    malus_fatigue_reordonnancement_tardif: "number",
    jour_premier_assaut: "number",
  },
  carte: {
    lieux_par_joueur_actif: "number",
    lieux_min: "number",
    lieux_max: "number",
    profondeur_entree_place_forte_min: "number",
    profondeur_entree_place_forte_max: "number",
    goulots_min: "number",
    goulots_max: "number",
    entrees_min: "number",
    entrees_max: "number",
    abords: {
      feu_de_guet: "number",
      poste_avance: "number",
      fosse: "number",
    },
  },
  grades: {
    seuils_effectif: {
      caporal: "number",
      sergent: "number",
      capitaine: "number",
      general: "number",
    },
    conditions_reserve: {
      caporal: "number",
      sergent: "number",
      capitaine: "number",
      general: "number",
    },
    coordination: {
      recrue: "number",
      soldat: "number",
      caporal: "number",
      sergent: "number",
      capitaine: "number",
      general: "number",
    },
    mandat_jours: "number",
    interim_apres_heures_inactivite: "number",
    decroissance_si_non_exerce_une_lune: "number",
  },
  combat: {
    rounds_max: "number",
    taux_pertes_par_round: "number",
    seuil_rupture_abord: "number",
    malus_flanc_apres_rupture: "number",
    clamp_force_min: "number",
    clamp_force_max: "number",
    abords_place_forte_min: "number",
    abords_place_forte_max: "number",
    matrice_posture: {
      mur: {
        souche: "number",
        ecorcheur: "number",
        belier: "number",
        chien_de_fosse: "number",
        muet: "number",
      },
      cognee: {
        souche: "number",
        ecorcheur: "number",
        belier: "number",
        chien_de_fosse: "number",
        muet: "number",
      },
      fer: {
        souche: "number",
        ecorcheur: "number",
        belier: "number",
        chien_de_fosse: "number",
        muet: "number",
      },
    },
    modificateurs: {
      fortification_par_niveau: "number",
      garnison_affamee: "number",
      fatigue_combat_veille: "number",
      usure_equipement_min: "number",
    },
  },
  horde: {
    exposant_adaptation_population: "number",
    fenetre_mesure_activite_jours: "number",
    plancher_intensite: "number",
    plafond_intensite_par_front: "number",
    production_par_fosse_par_jour: "number",
    doctrines_total: "number",
    doctrines_par_lune: "number",
    diviseur_fronts: "number",
    multiplicateur_offensive: "number",
    part_goulot: "number",
  },
  renseignement: {
    delai_patrouille_heures: "number",
    delai_eclaireur_jours: "number",
    delai_espion_jours: "number",
    questions_espion_par_cycle: "number",
  },
  blessures: {
    duree_heures: { legere: "number", serieuse: "number", grave: "number" },
    escalade_facteur: "number",
    fenetre_escalade_heures: "number",
    places_eleves_par_blesse: "number",
    plafond_piste_arriere_par_lune: "number",
    part_des_pertes: "number",
    seuils_severite: { serieuse: "number", grave: "number" },
  },
  economie: {
    rendement_auto_production_veteran: "number",
    usure_batailles_neuf: "number",
    usure_batailles_apres_demobilisation: "number",
    cout_reparation_ratio: "number",
    matieres_par_province_tenue_par_jour: "number",
    rendement_atelier: "number",
  },
  progression: {
    multiplicateur_besoin_min: "number",
    multiplicateur_besoin_max: "number",
    bonus_ordre_accompli: "number",
    satiete_quotidienne_par_activite: "number",
    jours_cible_acces_marche: "number",
    ratio_paliers: "number",
    base_evenement: "number",
  },
  terrain: {
    crete: "object",
    marais: "object",
    foret: "object",
    delta: "object",
    plaine: "object",
  },
  ravitaillement: {
    capacite_max: {
      place_forte: "number",
      feu_de_guet: "number",
      poste_avance: "number",
    },
    consommation_par_jour: "number",
    consommation_assaut: "number",
    recharge_par_jour: "number",
    seuil_affamee_jours: "number",
  },
  compression: {
    max_par_lune: "number",
  },
  generation: {
    essais_max: "number",
    part_terrain_dominant: "number",
    cycles_min: "number",
    cycles_max: "number",
    fosses_min: "number",
    fosses_max: "number",
  },
  usure: {
    par_assaut: "number",
    penalite_abord_rompu: "number",
  },
};
