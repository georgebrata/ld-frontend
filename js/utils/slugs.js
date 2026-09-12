/**
 * Convert platform label to URL slug.
 * @param {string} platform
 * @returns {string}
 */
export function toPlatformSlug(platform) {
  return String(platform ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

/**
 * Convert a service name to a URL slug.
 * @param {string} name
 * @returns {string}
 */
export function toServiceSlug(name) {
  const slug = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'service';
}

/**
 * Assign unique per-platform slugs. Collisions append the service id.
 * @param {Array<{ id: string, platform: string, service: string, slug?: string }>} services
 * @returns {Array<{ id: string, platform: string, service: string, slug: string }>}
 */
export function assignServiceSlugs(services) {
  /** @type {Map<string, Set<string>>} */
  const used = new Map();

  return services.map((service) => {
    const key = service.platform;
    if (!used.has(key)) used.set(key, new Set());
    const taken = used.get(key);
    const requested = service.slug ? toServiceSlug(service.slug) : '';
    let slug = requested || toServiceSlug(service.service);

    if (taken.has(slug)) {
      const withId = toServiceSlug(`${service.service}-${service.id}`);
      slug = taken.has(withId) ? `${slug}-${service.id}` : withId;
    }

    taken.add(slug);
    return { ...service, slug };
  });
}
