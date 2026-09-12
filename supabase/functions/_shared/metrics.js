/**
 * Redacted operational metrics. Never include tokens, emails, comments, or secrets.
 */

import { logInfo } from './log.js';

/**
 * @param {string} name
 * @param {Record<string, unknown>} [fields]
 */
export function emitMetric(name, fields = {}) {
  logInfo('metric', { metric: name, ...fields });
}

/**
 * @param {object} snapshot
 */
export function queueAlerts(snapshot) {
  const alerts = [];
  if ((snapshot.jobsFailed || 0) > 0) alerts.push('jobs_failed');
  if ((snapshot.unknownSubmissions || 0) > 0) alerts.push('submission_unknown');
  if ((snapshot.deferredFulfillment || 0) > 0) alerts.push('fulfillment_deferred');
  if ((snapshot.jobsPending || 0) > 50) alerts.push('queue_backlog');
  return alerts;
}
