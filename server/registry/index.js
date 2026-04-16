'use strict';

/**
 * WAB Registry - Agent & Command Registry
 *
 * Ecosystem foundation (like npm for agents):
 * - Command registry (registered site capabilities)
 * - Agent registry (available agents & their capabilities)
 * - Site registry (WAB-enabled sites)
 * - Template registry (reusable agent workflows)
 */

const crypto = require('crypto');
const { bus } = require('../runtime/event-bus');
const { metrics } = require('../observability');

// ─── Command Registry ───────────────────────────────────────────────────────

class CommandRegistry {
  constructor() {
    this._commands = new Map();    // commandId → command definition
    this._siteCommands = new Map(); // siteId → Set<commandId>
    this._categories = new Map();   // category → Set<commandId>
  }

  /**
   * Register a command that a site supports
   */
  register(siteId, command) {
    const commandId = `cmd_${crypto.randomBytes(12).toString('hex')}`;
    const entry = {
      id: commandId,
      siteId,
      name: command.name,
      description: command.description || '',
      category: command.category || 'general',
      version: command.version || '1.0.0',
      input: command.input || {},   // JSON Schema
      output: command.output || {}, // JSON Schema
      capabilities: command.capabilities || [],
      examples: command.examples || [],
      tags: command.tags || [],
      deprecated: command.deprecated || false,
      registeredAt: Date.now(),
      usageCount: 0,
      lastUsed: null,
    };

    this._commands.set(commandId, entry);

    // Index by site
    if (!this._siteCommands.has(siteId)) this._siteCommands.set(siteId, new Set());
    this._siteCommands.get(siteId).add(commandId);

    // Index by category
    if (!this._categories.has(entry.category)) this._categories.set(entry.category, new Set());
    this._categories.get(entry.category).add(commandId);

    metrics.increment('registry.commands.registered');
    bus.emit('registry.command.registered', { commandId, siteId, name: command.name });

    return entry;
  }

  /**
   * Search commands
   */
  search(query = {}) {
    const results = [];

    for (const [, cmd] of this._commands) {
      if (query.siteId && cmd.siteId !== query.siteId) continue;
      if (query.category && cmd.category !== query.category) continue;
      if (query.name && !cmd.name.toLowerCase().includes(query.name.toLowerCase())) continue;
      if (query.tag && !cmd.tags.includes(query.tag)) continue;
      if (query.capability) {
        if (!cmd.capabilities.some(c => c.includes(query.capability))) continue;
      }
      results.push(cmd);
    }

    // Sort by usage
    results.sort((a, b) => b.usageCount - a.usageCount);
    return results.slice(0, query.limit || 50);
  }

  /**
   * Get commands for a site
   */
  getSiteCommands(siteId) {
    const ids = this._siteCommands.get(siteId);
    if (!ids) return [];
    return [...ids].map(id => this._commands.get(id)).filter(Boolean);
  }

  /**
   * Get command by ID
   */
  getCommand(commandId) {
    return this._commands.get(commandId) || null;
  }

  /**
   * Track command usage
   */
  trackUsage(commandId) {
    const cmd = this._commands.get(commandId);
    if (cmd) {
      cmd.usageCount++;
      cmd.lastUsed = Date.now();
    }
  }

  /**
   * Get categories with counts
   */
  getCategories() {
    const cats = {};
    for (const [cat, ids] of this._categories) {
      cats[cat] = ids.size;
    }
    return cats;
  }

  /**
   * Unregister all commands for a site
   */
  unregisterSite(siteId) {
    const ids = this._siteCommands.get(siteId);
    if (!ids) return;
    for (const id of ids) {
      const cmd = this._commands.get(id);
      if (cmd) {
        const catIds = this._categories.get(cmd.category);
        if (catIds) catIds.delete(id);
      }
      this._commands.delete(id);
    }
    this._siteCommands.delete(siteId);
  }

  getStats() {
    return {
      totalCommands: this._commands.size,
      totalSites: this._siteCommands.size,
      categories: this.getCategories(),
    };
  }
}

// ─── Site Registry ──────────────────────────────────────────────────────────

class SiteRegistry {
  constructor() {
    this._sites = new Map(); // domain → site entry
  }

  /**
   * Register a WAB-enabled site
   */
  register(domain, info) {
    const entry = {
      domain,
      name: info.name || domain,
      description: info.description || '',
      tier: info.tier || 'free',
      protocolVersion: info.protocolVersion || '1.0.0',
      capabilities: info.capabilities || [],
      endpoints: {
        discover: info.discoverUrl || `https://${domain}/.well-known/wab.json`,
        execute: info.executeUrl || `https://${domain}/api/wab/execute`,
        negotiate: info.negotiateUrl || null,
      },
      verified: info.verified || false,
      registeredAt: Date.now(),
      lastSeen: Date.now(),
      commandCount: 0,
      agentVisits: 0,
    };

    this._sites.set(domain, entry);
    metrics.increment('registry.sites.registered');
    bus.emit('registry.site.registered', { domain });
    return entry;
  }

  /**
   * Get site info
   */
  getSite(domain) {
    return this._sites.get(domain) || null;
  }

  /**
   * Search sites
   */
  search(query = {}) {
    const results = [];
    for (const [, site] of this._sites) {
      if (query.tier && site.tier !== query.tier) continue;
      if (query.capability && !site.capabilities.includes(query.capability)) continue;
      if (query.name && !site.name.toLowerCase().includes(query.name.toLowerCase())) continue;
      if (query.verified !== undefined && site.verified !== query.verified) continue;
      results.push(site);
    }
    results.sort((a, b) => b.agentVisits - a.agentVisits);
    return results.slice(0, query.limit || 50);
  }

  /**
   * Track a visit
   */
  trackVisit(domain) {
    const site = this._sites.get(domain);
    if (site) {
      site.agentVisits++;
      site.lastSeen = Date.now();
    }
  }

  /**
   * List all sites
   */
  listSites(limit = 100) {
    return Array.from(this._sites.values()).slice(0, limit);
  }

  getStats() {
    return {
      totalSites: this._sites.size,
      verifiedSites: Array.from(this._sites.values()).filter(s => s.verified).length,
    };
  }
}

// ─── Template Registry ──────────────────────────────────────────────────────

class TemplateRegistry {
  constructor() {
    this._templates = new Map(); // templateId → template
  }

  /**
   * Register a workflow template
   */
  register(template) {
    const templateId = template.id || `tmpl_${crypto.randomBytes(12).toString('hex')}`;
    const entry = {
      id: templateId,
      name: template.name,
      description: template.description || '',
      category: template.category || 'general',
      author: template.author || 'system',
      version: template.version || '1.0.0',

      // Workflow definition
      steps: template.steps || [],
      variables: template.variables || {},
      requiredCapabilities: template.requiredCapabilities || [],

      // Metadata
      tags: template.tags || [],
      downloads: 0,
      rating: 0,
      reviews: 0,
      registeredAt: Date.now(),
    };

    this._templates.set(templateId, entry);
    metrics.increment('registry.templates.registered');
    return entry;
  }

  /**
   * Get a template
   */
  getTemplate(templateId) {
    return this._templates.get(templateId) || null;
  }

  /**
   * Search templates
   */
  search(query = {}) {
    const results = [];
    for (const [, tmpl] of this._templates) {
      if (query.category && tmpl.category !== query.category) continue;
      if (query.name && !tmpl.name.toLowerCase().includes(query.name.toLowerCase())) continue;
      if (query.tag && !tmpl.tags.includes(query.tag)) continue;
      results.push(tmpl);
    }
    results.sort((a, b) => b.downloads - a.downloads);
    return results.slice(0, query.limit || 50);
  }

  /**
   * Track template download
   */
  trackDownload(templateId) {
    const tmpl = this._templates.get(templateId);
    if (tmpl) tmpl.downloads++;
  }

  listTemplates(limit = 50) {
    return Array.from(this._templates.values()).slice(0, limit);
  }

  getStats() {
    return { totalTemplates: this._templates.size };
  }
}

// ─── Singletons ─────────────────────────────────────────────────────────────

const commandRegistry = new CommandRegistry();
const siteRegistry = new SiteRegistry();
const templateRegistry = new TemplateRegistry();

module.exports = {
  CommandRegistry,
  SiteRegistry,
  TemplateRegistry,
  commandRegistry,
  siteRegistry,
  templateRegistry,
};
