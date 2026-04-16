'use strict';

/**
 * Marketplace Engine
 *
 * Tools & integrations marketplace with publishing, discovery, purchasing,
 * and revenue sharing (15% platform commission).
 */

const crypto = require('crypto');
const { bus } = require('../runtime/event-bus');
const { MARKETPLACE } = require('../config/plans');

class MarketplaceEngine {
  constructor() {
    this._listings = new Map();    // listingId → Listing
    this._purchases = new Map();   // purchaseId → Purchase
    this._reviews = new Map();     // listingId → Review[]
    this._earnings = new Map();    // sellerId → EarningsRecord
  }

  /**
   * Publish a listing to the marketplace
   */
  publish(listing) {
    if (!listing.name || !listing.type || !listing.sellerId) {
      throw new Error('name, type, and sellerId are required');
    }
    if (!MARKETPLACE.categories.includes(listing.category || 'automation')) {
      throw new Error(`Invalid category. Must be one of: ${MARKETPLACE.categories.join(', ')}`);
    }
    if (listing.price !== undefined && listing.price !== 0) {
      if (listing.price < MARKETPLACE.minPrice || listing.price > MARKETPLACE.maxPrice) {
        throw new Error(`Price must be between $${MARKETPLACE.minPrice} and $${MARKETPLACE.maxPrice}`);
      }
    }

    const id = `mkt_${crypto.randomBytes(8).toString('hex')}`;
    const entry = {
      id,
      name: listing.name,
      description: listing.description || '',
      type: listing.type,         // 'tool', 'template', 'adapter', 'plugin', 'integration'
      category: listing.category || 'automation',
      sellerId: listing.sellerId,
      sellerName: listing.sellerName || 'Anonymous',
      price: listing.price || 0,  // 0 = free
      currency: 'usd',
      version: listing.version || '1.0.0',
      tags: listing.tags || [],
      icon: listing.icon || null,
      readme: listing.readme || '',
      installCommand: listing.installCommand || null,
      configSchema: listing.configSchema || null,
      entryPoint: listing.entryPoint || null,

      // Stats
      installs: 0,
      revenue: 0,
      rating: 0,
      reviewCount: 0,

      // Status
      status: 'pending_review',   // pending_review → approved → published | rejected
      publishedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this._listings.set(id, entry);
    this._reviews.set(id, []);
    bus.emit('marketplace.listed', { id, name: entry.name, type: entry.type, price: entry.price });
    return entry;
  }

  /**
   * Approve a listing (admin action)
   */
  approve(listingId) {
    const listing = this._listings.get(listingId);
    if (!listing) throw new Error('Listing not found');
    listing.status = 'published';
    listing.publishedAt = Date.now();
    listing.updatedAt = Date.now();
    bus.emit('marketplace.approved', { id: listingId, name: listing.name });
    return listing;
  }

  /**
   * Reject a listing (admin action)
   */
  reject(listingId, reason) {
    const listing = this._listings.get(listingId);
    if (!listing) throw new Error('Listing not found');
    listing.status = 'rejected';
    listing.rejectionReason = reason;
    listing.updatedAt = Date.now();
    return listing;
  }

  /**
   * Purchase/install a listing
   */
  purchase(listingId, buyerId) {
    const listing = this._listings.get(listingId);
    if (!listing) throw new Error('Listing not found');
    if (listing.status !== 'published') throw new Error('Listing not available');

    const purchaseId = `pur_${crypto.randomBytes(8).toString('hex')}`;
    const commission = listing.price * MARKETPLACE.commission;
    const sellerEarning = listing.price - commission;

    const purchase = {
      id: purchaseId,
      listingId,
      listingName: listing.name,
      buyerId,
      sellerId: listing.sellerId,
      price: listing.price,
      commission,
      sellerEarning,
      currency: 'usd',
      status: listing.price === 0 ? 'completed' : 'pending_payment',
      createdAt: Date.now(),
    };

    this._purchases.set(purchaseId, purchase);
    listing.installs++;

    // Track earnings
    if (sellerEarning > 0) {
      const earnings = this._earnings.get(listing.sellerId) || { total: 0, pending: 0, paid: 0 };
      earnings.total += sellerEarning;
      earnings.pending += sellerEarning;
      this._earnings.set(listing.sellerId, earnings);
    }

    listing.revenue += listing.price;
    bus.emit('marketplace.purchased', { purchaseId, listingId, buyerId, price: listing.price });
    return purchase;
  }

  /**
   * Complete payment for a purchase
   */
  completePayment(purchaseId) {
    const purchase = this._purchases.get(purchaseId);
    if (!purchase) throw new Error('Purchase not found');
    purchase.status = 'completed';
    purchase.completedAt = Date.now();
    return purchase;
  }

  /**
   * Add a review
   */
  addReview(listingId, review) {
    const listing = this._listings.get(listingId);
    if (!listing) throw new Error('Listing not found');

    const reviews = this._reviews.get(listingId) || [];
    const entry = {
      id: `rev_${crypto.randomBytes(6).toString('hex')}`,
      userId: review.userId,
      rating: Math.max(1, Math.min(5, review.rating)),
      comment: review.comment || '',
      createdAt: Date.now(),
    };
    reviews.push(entry);
    this._reviews.set(listingId, reviews);

    // Update average rating
    listing.reviewCount = reviews.length;
    listing.rating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
    listing.rating = Math.round(listing.rating * 10) / 10;

    return entry;
  }

  /**
   * Search listings
   */
  search(filters = {}, limit = 50) {
    let results = Array.from(this._listings.values())
      .filter(l => l.status === 'published');

    if (filters.type) results = results.filter(l => l.type === filters.type);
    if (filters.category) results = results.filter(l => l.category === filters.category);
    if (filters.sellerId) results = results.filter(l => l.sellerId === filters.sellerId);
    if (filters.free) results = results.filter(l => l.price === 0);
    if (filters.paid) results = results.filter(l => l.price > 0);
    if (filters.minRating) results = results.filter(l => l.rating >= filters.minRating);
    if (filters.tag) results = results.filter(l => l.tags.includes(filters.tag));
    if (filters.query) {
      const q = filters.query.toLowerCase();
      results = results.filter(l =>
        l.name.toLowerCase().includes(q) ||
        l.description.toLowerCase().includes(q) ||
        l.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    // Sort
    const sortBy = filters.sortBy || 'installs';
    results.sort((a, b) => {
      if (sortBy === 'rating') return b.rating - a.rating;
      if (sortBy === 'newest') return b.createdAt - a.createdAt;
      if (sortBy === 'price') return a.price - b.price;
      return b.installs - a.installs; // default: popular
    });

    return results.slice(0, limit);
  }

  /**
   * Get listing by ID
   */
  getListing(id) {
    return this._listings.get(id) || null;
  }

  /**
   * Get reviews for a listing
   */
  getReviews(listingId) {
    return this._reviews.get(listingId) || [];
  }

  /**
   * Get seller earnings
   */
  getEarnings(sellerId) {
    return this._earnings.get(sellerId) || { total: 0, pending: 0, paid: 0 };
  }

  /**
   * Get purchases for a buyer
   */
  getPurchases(buyerId) {
    return Array.from(this._purchases.values())
      .filter(p => p.buyerId === buyerId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Admin: list pending listings
   */
  getPendingListings() {
    return Array.from(this._listings.values())
      .filter(l => l.status === 'pending_review')
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  getStats() {
    const listings = Array.from(this._listings.values());
    return {
      totalListings: listings.length,
      published: listings.filter(l => l.status === 'published').length,
      pending: listings.filter(l => l.status === 'pending_review').length,
      totalPurchases: this._purchases.size,
      totalRevenue: listings.reduce((sum, l) => sum + l.revenue, 0),
      categories: MARKETPLACE.categories,
      commission: MARKETPLACE.commission,
    };
  }
}

const marketplace = new MarketplaceEngine();

module.exports = { MarketplaceEngine, marketplace };
