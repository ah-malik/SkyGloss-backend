import { countriesMatch } from './country-match';

describe('countriesMatch', () => {
  it('matches Czechia aliases used by admin vs shop registration', () => {
    expect(countriesMatch('Czech Republic', 'Czechia (Czech Republic)')).toBe(true);
    expect(countriesMatch('Czechia', 'Czechia (Czech Republic)')).toBe(true);
    expect(countriesMatch('Czechia', 'Czech Republic')).toBe(true);
    expect(countriesMatch('czechia (czech republic)', 'Czech Republic')).toBe(true);
  });

  it('does not match unrelated countries', () => {
    expect(countriesMatch('Czech Republic', 'Slovakia')).toBe(false);
    expect(countriesMatch('Czechia (Czech Republic)', 'Germany')).toBe(false);
  });

  it('matches parenthetical admin names to library names', () => {
    expect(countriesMatch('Myanmar', 'Myanmar (formerly Burma)')).toBe(true);
    expect(countriesMatch('Burma', 'Myanmar (formerly Burma)')).toBe(true);
  });
});
