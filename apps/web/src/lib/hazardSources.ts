export type HazardSourceMeta = {
  name: string
  url: string | null
  isSeeded: boolean
}

const SEEDED_SOURCES: Record<string, Omit<HazardSourceMeta, 'isSeeded'>> = {
  glofas_seeded: {
    name: 'GLOFAS (Global Flood Awareness System)',
    url: 'https://global-flood.emergency.copernicus.eu/',
  },
  icpac_seeded: {
    name: 'IGAD ICPAC',
    url: 'https://www.icpac.net/',
  },
  fao_dlis_seeded: {
    name: 'FAO DLIS (Desert Locust)',
    url: 'https://www.fao.org/locusts/en/',
  },
  usgs_seeded: {
    name: 'USGS',
    url: 'https://www.usgs.gov/programs/earthquake-hazards',
  },
}

export function hazardSourceMeta(source: string | null | undefined): HazardSourceMeta {
  if (source && SEEDED_SOURCES[source]) {
    return { ...SEEDED_SOURCES[source], isSeeded: true }
  }
  return {
    name: source || 'Source not recorded',
    url: null,
    isSeeded: false,
  }
}
