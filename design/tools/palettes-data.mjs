const KEYS = {
  ground: '#FBF4EA', ground2: '#F4E9DA', surface: '#FFFBF5', line: '#EADFCF', ink: '#2A1E17', muted: '#7A6A5D', faint: '#A99A8C',
  brandTint: '#F1E6DA', onBrandSoft: '#C9B6A4', night: '#1F1611', primary: '#C4561F', primary2: '#A8461A', primaryTint: '#FBE4D6',
  onPrimarySoft: '#F6C9AE', gold2: '#E9A27A', goldInk: '#9A3F14', apricot: '#F5A270', bar2: '#E08A4F', bar4: '#F2C3A2',
};

export const PALETTES = [
  { id: 'A', name: 'Cream & burnt orange', note: 'Warm, homely, timber and terracotta', c: { ...KEYS } },
  {
    id: 'B', name: 'Navy & clay', note: 'Architectural, calm, trustworthy',
    c: { ground: '#F6F3EE', ground2: '#ECE6DD', surface: '#FFFFFF', line: '#E2DCD2', ink: '#14213D', muted: '#5E6677', faint: '#9AA0AD', brandTint: '#E6E9F0', onBrandSoft: '#AEB8CC', night: '#0E1830', primary: '#B5532D', primary2: '#96431F', primaryTint: '#F6E1D6', onPrimarySoft: '#F0C4AE', gold2: '#DE9A7C', goldInk: '#8A3C1C', apricot: '#E8A383', bar2: '#D0754C', bar4: '#EFC4AE' },
  },
  {
    id: 'C', name: 'Aubergine & raspberry', note: 'Bold, editorial, memorable',
    c: { ground: '#FAF5F2', ground2: '#F1E8E4', surface: '#FFFFFF', line: '#E8DCD8', ink: '#3A1F3D', muted: '#75626F', faint: '#A897A2', brandTint: '#EFE3EE', onBrandSoft: '#C7AFC4', night: '#24122A', primary: '#B8436B', primary2: '#993357', primaryTint: '#F7DDE6', onPrimarySoft: '#EFB9CB', gold2: '#DE93AD', goldInk: '#8A2C4C', apricot: '#E79AB6', bar2: '#CF6E90', bar4: '#F0C3D3' },
  },
  {
    id: 'D', name: 'Charcoal & saffron', note: 'Modern, high contrast, construction-site energy',
    c: { ground: '#F7F5F0', ground2: '#EDEAE2', surface: '#FFFFFF', line: '#E3DFD6', ink: '#1F2328', muted: '#61666D', faint: '#9A9EA4', brandTint: '#E8E9EB', onBrandSoft: '#AEB3B9', night: '#15181C', primary: '#B97D10', primary2: '#9A680C', primaryTint: '#F8EBCF', onPrimarySoft: '#EED29A', gold2: '#E2B85F', goldInk: '#7E5508', apricot: '#EDC26A', bar2: '#D49A2E', bar4: '#F1DCAA' },
  },
];

