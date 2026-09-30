# Données personnelles — inventaire (registre des traitements)

Source de la politique de confidentialité (`frontend/app/pages/politique-confidentialite.vue`) et
de la déclaration « Sécurité des données » de Google Play : les trois décrivent le même état. Toute
donnée ajoutée, tout prestataire ou toute durée changée se reporte **dans les trois**, puis
`TERMS_VERSION` (`backend/src/utils/account-rules.ts`) change si la modification est substantielle.

| Donnée | Finalité | Base légale | Durée | Où | Qui d'autre |
|---|---|---|---|---|---|
| E-mail, pseudo, mot de passe (bcrypt), date de naissance, date et version des CGU acceptées | Compte, âge minimum (15 ans), preuve d'acceptation | Contrat | Vie du compte ; non confirmée : 7 jours (`purge-retention`) | `up_users` | — |
| `google_sub` et e-mail Google | Connexion avec Google (Android) | Contrat | Vie du compte | `up_users.google_sub` | Google (vérification du jeton) |
| Guilde, personnages, objets, or/xp, progression, quêtes, expéditions (musée + dates), badges | Jeu | Contrat | Vie du compte | tables de jeu | — |
| Lieux visités (POI, date de dernière ouverture, nombre) | Récompenser et limiter les ouvertures de coffre | Contrat | Vie du compte | `visits` | — |
| Position GPS instantanée | Vérifier la présence au coffre / au musée | Consentement (permission de l'appareil) | Non conservée (comparée puis oubliée) | mémoire de Strapi | — |
| Tracé des déplacements (brouillard) | Afficher les zones explorées | Consentement | Sur l'appareil seulement | `localStorage` | — |
| Réponses, score, durée du quiz | Récompenses, classement | Contrat | Vie du compte | `quiz_attempts` | — |
| Amitiés, publications, « J'aime » | Social | Contrat | Jusqu'à suppression (publications effacées avec le compte) | `player_friendships`, `posts` | Autres joueurs (pseudo, guilde, publications) |
| Photo de profil | Personnalisation | Consentement | Jusqu'au retrait | médias Strapi | Autres joueurs |
| Adresse pour e-mails de service | Confirmation, réinitialisation, avertissement de doublon | Contrat | Journal Brevo sans limite de durée | Brevo | Brevo (France) |
| Date de chaque connexion | Sécurité, statistiques | Intérêt légitime | 6 mois (`purge-retention`) | `connection_logs` | — |
| Identifiant saisi + IP (tentatives) | Limiter les essais | Intérêt légitime | ≤ 1 h, en mémoire du BFF | processus Nuxt | — |
| IP tronquée, requêtes | Diagnostic | Intérêt légitime | 30 jours | journaux Caddy (serveur) | — |
| Demandes RGPD (date, état) | Suivi des droits | Obligation légale | Vie du compte | `gdpr_requests` (plus d'IP ; ancien champ vide) | — |
| Actions de modération (joueur visé, date, IP de l'admin) | Trace des décisions | Intérêt légitime | Durée du service ; joueur détaché à sa suppression | `admin_action_logs` | — |
| IP du joueur vue par les serveurs de tuiles | Afficher la carte | Intérêt légitime | Chez OSMF / Fastly | — | Fondation OpenStreetMap (Royaume-Uni, adéquation), Fastly (États-Unis, DPF) |

Hébergement : Hetzner (Nuremberg, UE). Sauvegardes nocturnes : 14 jours sur le serveur, 30 jours
sur le poste de rapatriement. Aucun traceur, aucune mesure d'audience, aucun SDK tiers dans le site ;
l'app Android n'ajoute que Credential Manager (Google, à la demande du joueur).
