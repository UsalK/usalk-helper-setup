// Pasife alınan varyasyon profilleri (backend/db/db.js içindeki liste ile aynı olmalı).
// Buradaki profiller listelerde gösterilmez ve otomatik oran eşleştirmesine girmez.
//
// 'double_1_2' eski ikili set yapılandırmasıdır; tek panelli 1:2 profiliyle aynı
// oran anahtarını paylaştığı için kaldırıldı. Yerine 'set_of_2_1_2' geldi.
export const DISABLED_PROFILE_IDS = ['double_1_2'];

// Çok panelli set profilleri (backend/db/db.js → SET_PROFILE_IDS ile aynı olmalı).
export const SET_PROFILE_IDS = ['set_of_2_1_2', 'set_of_2_2_3'];

const idOf = (profile) => (typeof profile === 'string' ? profile : profile?.id);

export const isDisabledProfile = (profile) =>
  DISABLED_PROFILE_IDS.includes(idOf(profile));

/** Çok panelli (Set of 2 gibi) profil mi? */
export const isSetProfile = (profile) => {
  if (typeof profile !== 'string' && profile?.kind === 'set') return true;
  return SET_PROFILE_IDS.includes(idOf(profile));
};

export const filterActiveProfiles = (profiles = []) =>
  profiles.filter(p => !isDisabledProfile(p));

/**
 * Görsel oranından otomatik profil seçiminde kullanılabilecek profiller.
 * Set profilleri hariç tutulur: oranları tek panelin oranı olduğu için tek
 * panelli profillerle çakışır, kullanıcının bilerek seçmesi gerekir.
 */
export const filterAutoMatchProfiles = (profiles = []) =>
  profiles.filter(p => !isDisabledProfile(p) && !isSetProfile(p));
