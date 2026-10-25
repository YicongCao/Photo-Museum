export const subjectLabel = tag => tag.label_zh || tag.label;
export const placeLabel = place => place ? ['country','province','city','district','street']
  .map(k=>place.display_zh?.[k] ?? place[k]).filter(Boolean).join(' · ') : '';
