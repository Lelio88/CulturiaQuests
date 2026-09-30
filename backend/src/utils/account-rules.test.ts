import { describe, it, expect } from 'vitest';
import {
  ageAt,
  birthDateProblem,
  cleanEmail,
  cleanUsername,
  parseProfile,
  parseRegistration,
  passwordProblem,
} from './account-rules';

const TODAY = new Date('2026-10-01T10:00:00Z');

const valid = {
  username: 'Aventurière',
  email: '  Joueur@Exemple.FR ',
  password: 'motdepasse1',
  date_of_birth: '2005-04-12',
  terms_accepted: true,
  guildName: 'Les Curieux',
  firstname: 'Ada',
  lastname: 'Lovelace',
  iconId: 12,
};

describe('passwordProblem', () => {
  it('refuse moins de 8 caractères', () => {
    expect(passwordProblem('abc123')).toBe('password_too_short');
  });

  it('exige au moins une lettre et un chiffre', () => {
    expect(passwordProblem('motdepasse')).toBe('password_needs_letter_and_digit');
    expect(passwordProblem('12345678')).toBe('password_needs_letter_and_digit');
  });

  it('accepte les lettres accentuées comme lettres', () => {
    expect(passwordProblem('éèàùç1234')).toBeNull();
  });

  it('refuse au-delà de 72 octets (limite de bcrypt)', () => {
    expect(passwordProblem(`a1${'x'.repeat(71)}`)).toBe('password_too_long');
  });

  it('refuse une valeur qui n’est pas une chaîne', () => {
    expect(passwordProblem(undefined)).toBe('password_too_short');
  });
});

describe('ageAt', () => {
  it('ne compte pas l’année avant l’anniversaire', () => {
    expect(ageAt(new Date('2011-10-02T00:00:00Z'), TODAY)).toBe(14);
    expect(ageAt(new Date('2011-10-01T00:00:00Z'), TODAY)).toBe(15);
  });
});

describe('birthDateProblem', () => {
  it('accepte 15 ans le jour même', () => {
    expect(birthDateProblem('2011-10-01', TODAY)).toBeNull();
  });

  it('refuse la veille des 15 ans', () => {
    expect(birthDateProblem('2011-10-02', TODAY)).toBe('too_young');
  });

  it('refuse une date qui n’existe pas au lieu de la faire rouler', () => {
    expect(birthDateProblem('2005-02-31', TODAY)).toBe('birth_date_invalid');
  });

  it('refuse une date future ou absurde', () => {
    expect(birthDateProblem('2030-01-01', TODAY)).toBe('birth_date_invalid');
    expect(birthDateProblem('1880-01-01', TODAY)).toBe('birth_date_invalid');
  });

  it('refuse un autre format que AAAA-MM-JJ', () => {
    expect(birthDateProblem('12/04/2005', TODAY)).toBe('birth_date_invalid');
  });
});

describe('cleanUsername / cleanEmail', () => {
  it('rejette un pseudo en forme d’adresse', () => {
    expect(cleanUsername('moi@exemple.fr')).toBeNull();
  });

  it('rejette un pseudo avec retour à la ligne', () => {
    expect(cleanUsername('ab\ncd')).toBeNull();
  });

  it('met l’adresse en minuscules et retire les espaces', () => {
    expect(cleanEmail('  A@B.FR ')).toBe('a@b.fr');
  });
});

describe('parseRegistration', () => {
  it('accepte une inscription complète et nettoie les valeurs', () => {
    const result = parseRegistration(valid, TODAY);
    expect(result).toEqual({
      ok: true,
      value: {
        username: 'Aventurière',
        email: 'joueur@exemple.fr',
        password: 'motdepasse1',
        dateOfBirth: '2005-04-12',
        guildName: 'Les Curieux',
        firstname: 'Ada',
        lastname: 'Lovelace',
        iconId: 12,
      },
    });
  });

  it('exige l’acceptation explicite des CGU (true, pas "true")', () => {
    expect(parseRegistration({ ...valid, terms_accepted: 'true' }, TODAY)).toEqual({
      ok: false,
      code: 'terms_not_accepted',
    });
  });

  it('refuse une icône non numérique', () => {
    expect(parseRegistration({ ...valid, iconId: 'abc' }, TODAY)).toEqual({ ok: false, code: 'icon_invalid' });
  });

  it('refuse un nom de personnage vide', () => {
    expect(parseRegistration({ ...valid, lastname: '   ' }, TODAY)).toEqual({
      ok: false,
      code: 'character_name_invalid',
    });
  });

  it('refuse un corps qui n’est pas un objet', () => {
    expect(parseRegistration(null, TODAY)).toEqual({ ok: false, code: 'invalid_body' });
  });
});

describe('parseProfile', () => {
  it('n’exige ni adresse ni mot de passe (inscription Google)', () => {
    const { email, password, ...profile } = valid;
    expect(parseProfile(profile, TODAY).ok).toBe(true);
  });
});
