const A = (k: string, v: string) => `"${k}"="${v}"`;
const MAP: Record<string, string[]> = {
  // health
  dentist: [A('amenity', 'dentist')], dental: [A('amenity', 'dentist')], 'dental clinic': [A('amenity', 'dentist')],
  doctor: [A('amenity', 'doctors')], clinic: [A('amenity', 'clinic')], pharmacy: [A('amenity', 'pharmacy')],
  veterinarian: [A('amenity', 'veterinary')], vet: [A('amenity', 'veterinary')],
  chiropractor: [A('healthcare', 'chiropractor')], physiotherapist: [A('healthcare', 'physiotherapist')], physio: [A('healthcare', 'physiotherapist')],
  optician: [A('shop', 'optician')], optometrist: [A('shop', 'optician')], massage: [A('shop', 'massage')],
  // food & hospitality
  restaurant: [A('amenity', 'restaurant')], cafe: [A('amenity', 'cafe')], coffee: [A('amenity', 'cafe')], bar: [A('amenity', 'bar')],
  bakery: [A('shop', 'bakery')], hotel: [A('tourism', 'hotel')], 'bed and breakfast': [A('tourism', 'guest_house')],
  // beauty & fitness
  gym: [A('leisure', 'fitness_centre')], fitness: [A('leisure', 'fitness_centre')], 'yoga studio': [A('sport', 'yoga')],
  salon: [A('shop', 'hairdresser')], 'hair salon': [A('shop', 'hairdresser')], hairdresser: [A('shop', 'hairdresser')], barber: [A('shop', 'hairdresser')],
  beauty: [A('shop', 'beauty')], 'nail salon': [A('shop', 'beauty')], spa: [A('leisure', 'spa'), A('shop', 'beauty')], tattoo: [A('shop', 'tattoo')],
  // professional services
  lawyer: [A('office', 'lawyer')], attorney: [A('office', 'lawyer')], 'law firm': [A('office', 'lawyer')],
  accountant: [A('office', 'accountant')], accounting: [A('office', 'accountant')], 'tax advisor': [A('office', 'tax_advisor')],
  realtor: [A('office', 'estate_agent')], 'real estate': [A('office', 'estate_agent')], 'real estate agent': [A('office', 'estate_agent')],
  insurance: [A('office', 'insurance')], 'insurance agent': [A('office', 'insurance')], architect: [A('office', 'architect')],
  'marketing agency': [A('office', 'advertising_agency')], 'advertising agency': [A('office', 'advertising_agency')],
  'it company': [A('office', 'it')], 'travel agency': [A('shop', 'travel_agency')], 'employment agency': [A('office', 'employment_agency')],
  consultant: [A('office', 'consulting')], 'financial advisor': [A('office', 'financial_advisor')],
  // moving & storage
  'moving company': [A('office', 'moving_company')], movers: [A('office', 'moving_company')], removals: [A('office', 'moving_company')],
  'removalist': [A('office', 'moving_company')], 'self storage': [A('shop', 'storage_rental')], storage: [A('shop', 'storage_rental')],
  // trades
  plumber: [A('craft', 'plumber')], electrician: [A('craft', 'electrician')], hvac: [A('craft', 'hvac')], roofer: [A('craft', 'roofer')],
  contractor: [A('craft', 'builder')], builder: [A('craft', 'builder')], painter: [A('craft', 'painter')], carpenter: [A('craft', 'carpenter')],
  gardener: [A('craft', 'gardener')], landscaper: [A('craft', 'gardener')], locksmith: [A('shop', 'locksmith')], photographer: [A('craft', 'photographer')],
  tiler: [A('craft', 'tiler')], plasterer: [A('craft', 'plasterer')], glazier: [A('craft', 'glaziery')],
  // rentals
  'car rental': [A('amenity', 'car_rental')], 'car hire': [A('amenity', 'car_rental')], 'rental car': [A('amenity', 'car_rental')],
  'boat rental': [A('amenity', 'boat_rental')], 'yacht rental': [A('amenity', 'boat_rental')], 'yacht charter': [A('amenity', 'boat_rental')], 'boat charter': [A('amenity', 'boat_rental')], 'boat hire': [A('amenity', 'boat_rental')],
  'short term rental': [A('tourism', 'apartment'), A('tourism', 'chalet')], 'vacation rental': [A('tourism', 'apartment'), A('tourism', 'chalet')], 'holiday rental': [A('tourism', 'apartment'), A('tourism', 'chalet')],
  'airbnb host': [A('tourism', 'apartment'), A('tourism', 'chalet')], 'holiday home': [A('tourism', 'apartment'), A('tourism', 'chalet')],
  // retail & auto
  florist: [A('shop', 'florist')], 'car repair': [A('shop', 'car_repair')], mechanic: [A('shop', 'car_repair')], 'car dealer': [A('shop', 'car')],
  'driving school': [A('amenity', 'driving_school')], 'pet shop': [A('shop', 'pet')], jeweler: [A('shop', 'jewelry')], 'dry cleaner': [A('shop', 'dry_cleaning')],
  laundry: [A('shop', 'laundry')], childcare: [A('amenity', 'childcare')], daycare: [A('amenity', 'childcare')], kindergarten: [A('amenity', 'kindergarten')],
};

export function mapTypeToTags(type: string): string[] {
  return MAP[type.trim().toLowerCase()] ?? [];
}

const FILLER = new Set(['company', 'companies', 'services', 'service', 'business', 'businesses', 'shop', 'store', 'local', 'and', 'the', 'near', 'of', 'in', 'for', 'artist', 'artists']);
/** Words to OR together in a name regex when no category matches. Regex-safe. */
export function nameKeywords(type: string): string[] {
  const words = type.toLowerCase().split(/\s+/).map(w => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  const keep = words.filter(w => !FILLER.has(w) && w.length > 1);
  return (keep.length ? keep : words).slice(0, 4);
}
