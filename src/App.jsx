import { useState, useEffect, useRef, useCallback } from "react";
import "./App.css";
import {
  Home, MapPin, MessageCircle, Plus, X, Search, ArrowRight, ArrowLeft,
  Image as ImageIcon, Send, Trash2, ShieldCheck, User, Building2,
  ChevronDown, Video, Loader2, Inbox, LogOut, Check, Upload, FileCheck2,
  ClipboardCheck, AlertTriangle, CheckCircle2, XCircle, Clock
} from "lucide-react";

/* ---------------------------------------------------------------
   Direct — buy, sell and rent directly from owners. No agents, no cut.
--------------------------------------------------------------- */

const LOGO_IMG = "/public/logo.png"; // public/logo.png
const HERO_IMG = "/public/hero.jpg"; // public/hero.jpg

const STATES = [
  "Abuja (FCT)", "Lagos", "Rivers", "Oyo", "Kano", "Kaduna", "Enugu",
  "Delta", "Ogun", "Anambra", "Edo", "Plateau", "Kwara", "Imo", "Abia"
];

const TYPES = [
  "Land", "Duplex", "Bungalow", "Apartment / Flat", "Terrace",
  "Semi-Detached", "Commercial Space", "Mini Flat / Self-Contain"
];

const AGENT_RATE = 0.10; // typical single-agent cut used for the calculator

function fmtNaira(n) {
  const num = Number(n) || 0;
  return "₦" + num.toLocaleString("en-NG");
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  return d + "d ago";
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const VERIFY_LABEL = {
  verified: { text: "Verified owner", cls: "verified", icon: CheckCircle2 },
  pending: { text: "Verification pending", cls: "pending", icon: Clock },
  rejected: { text: "Not verified", cls: "none", icon: XCircle },
  unverified: { text: "Not verified", cls: "none", icon: AlertTriangle },
};

function VerifiedBadge({ status, size = 12 }) {
  const v = VERIFY_LABEL[status] || VERIFY_LABEL.unverified;
  const Icon = v.icon;
  return (
    <span className={"dd-badge dd-badge-" + v.cls}>
      <Icon size={size} /> {v.text}
    </span>
  );
}

function compressImage(file, maxW = 900, quality = 0.62) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------------- storage helpers ---------------- */

const NS = "direct:";
const storageKey = (key, shared) => NS + (shared ? "shared:" : "me:") + key;

// NOTE: localStorage keeps data in ONE browser only. To share listings and chat
// between devices, replace these four helpers with calls to your backend
// (Firebase, Supabase, or your own API). Keep the same signatures.
async function safeGet(key, shared) {
  try {
    return localStorage.getItem(storageKey(key, shared));
  } catch (e) {
    return null;
  }
}
async function safeSet(key, value, shared) {
  try {
    localStorage.setItem(storageKey(key, shared), value);
    return true;
  } catch (e) {
    return false; // e.g. storage full
  }
}
async function safeList(prefix, shared) {
  try {
    const base = storageKey("", shared);
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const full = localStorage.key(i);
      if (full && full.startsWith(base + prefix)) keys.push(full.slice(base.length));
    }
    return keys;
  } catch (e) {
    return [];
  }
}
async function safeDelete(key, shared) {
  try {
    localStorage.removeItem(storageKey(key, shared));
    return true;
  } catch (e) {
    return false;
  }
}

/* ================================================================== */

export default function App() {
  const [booting, setBooting] = useState(true);
  const [profile, setProfile] = useState(null); // {id,name,role}
  const [view, setView] = useState("landing"); // landing|browse|detail|create|mine|chat
  const [listings, setListings] = useState([]);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [activeListing, setActiveListing] = useState(null);
  const [activeChat, setActiveChat] = useState(null); // {listingId, buyerId, buyerName?, ownerName}
  const [filters, setFilters] = useState({ state: "", type: "", q: "", verifiedOnly: false });
  const [toast, setToast] = useState(null);

  useEffect(() => {
    (async () => {
      const p = await safeGet("profile", false);
      if (p) {
        try {
          const parsed = JSON.parse(p);
          setProfile(parsed);
          if (parsed.role === "admin") setView("admin");
        } catch (e) {}
      }
      setBooting(false);
    })();
  }, []);

  function flash(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }

  async function saveProfile(p) {
    setProfile(p);
    setView(p.role === "admin" ? "admin" : "landing");
    await safeSet("profile", JSON.stringify(p), false);
  }

  async function switchProfile() {
    await safeDelete("profile", false).catch(() => {});
    setProfile(null);
    setView("landing");
  }

  const loadListings = useCallback(async () => {
    setListingsLoading(true);
    const keys = await safeList("listing:", true);
    const items = [];
    for (const k of keys) {
      const raw = await safeGet(k, true);
      if (raw) {
        try { items.push(JSON.parse(raw)); } catch (e) {}
      }
    }
    items.sort((a, b) => b.createdAt - a.createdAt);
    setListings(items);
    setListingsLoading(false);
  }, []);

  useEffect(() => {
    if (view === "browse" || view === "mine" || view === "landing" || view === "admin") loadListings();
  }, [view, loadListings]);

  async function decideVerification(listing, status, reviewNote) {
    const updated = {
      ...listing,
      verification: {
        ...listing.verification,
        status,
        reviewNote: reviewNote || "",
        reviewedAt: Date.now(),
      },
    };
    await safeSet(listing.id, JSON.stringify(updated), true);
    flash(status === "verified" ? "Listing approved and marked verified." : "Listing sent back — reason shared with the owner.");
    loadListings();
  }

  function goDetail(l) {
    setActiveListing(l);
    setView("detail");
  }

  function openChatAsBuyer(listing) {
    setActiveChat({
      listingId: listing.id,
      buyerId: profile.id,
      buyerName: profile.name,
      ownerName: listing.ownerName,
      listingTitle: listing.title,
    });
    setView("chat");
  }

  function openChatAsOwner(listing, buyerId, buyerName) {
    setActiveChat({
      listingId: listing.id,
      buyerId,
      buyerName,
      ownerName: listing.ownerName,
      listingTitle: listing.title,
    });
    setView("chat");
  }

  if (booting) {
    return (
      <div className="dd-root dd-boot">
        <Loader2 className="animate-spin" size={22} />
      </div>
    );
  }

  return (
    <div className="dd-root">
      <TopNav
        profile={profile}
        view={view}
        setView={setView}
        onSwitch={switchProfile}
        pendingCount={listings.filter((l) => l.verification?.status === "pending").length}
      />

      {!profile && view !== "onboarding" && (
        <Onboarding onDone={saveProfile} />
      )}

      {profile && (
        <main className={"dd-main" + (view === "landing" ? " flush" : "")}>
          {view === "landing" && (
            <Landing
              profile={profile}
              listings={listings}
              onBrowse={() => setView("browse")}
              onList={() => setView("create")}
              onOpen={goDetail}
            />
          )}

          {view === "browse" && (
            <Browse
              listings={listings}
              loading={listingsLoading}
              filters={filters}
              setFilters={setFilters}
              onOpen={goDetail}
            />
          )}

          {view === "detail" && activeListing && (
            <Detail
              listing={activeListing}
              profile={profile}
              onBack={() => setView("browse")}
              onMessage={() => openChatAsBuyer(activeListing)}
            />
          )}

          {view === "create" && profile.role === "owner" && (
            <CreateListing
              profile={profile}
              onDone={(l) => {
                flash("Listing published — visible to buyers now.");
                setView("mine");
              }}
            />
          )}

          {view === "mine" && profile.role === "owner" && (
            <MyListings
              profile={profile}
              listings={listings.filter((l) => l.ownerId === profile.id)}
              loading={listingsLoading}
              onOpenChat={openChatAsOwner}
              onDelete={async (id) => {
                await safeDelete(id, true);
                flash("Listing removed.");
                loadListings();
              }}
              onList={() => setView("create")}
              onRefresh={loadListings}
              flash={flash}
            />
          )}

          {view === "admin" && profile.role === "admin" && (
            <AdminQueue
              listings={listings}
              loading={listingsLoading}
              onDecision={decideVerification}
            />
          )}

          {view === "chat" && activeChat && (
            <ChatRoom
              chat={activeChat}
              profile={profile}
              onBack={() =>
                setView(profile.role === "owner" ? "mine" : "detail")
              }
            />
          )}
        </main>
      )}

      {toast && <div className="dd-toast">{toast}</div>}
    </div>
  );
}

/* ---------------- Onboarding ---------------- */

function Onboarding({ onDone }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");

  return (
    <div className="dd-onb-wrap">
      <div className="dd-onb">
        <img className="dd-onb-logo" src={LOGO_IMG} alt="Direct" />
        <h1 className="dd-onb-title">Welcome to Direct</h1>
        <p className="dd-onb-sub">
          Buy, sell and rent directly from owners. No agent in the middle,
          no cut out of your price.
        </p>

        <label className="dd-label">Your name</label>
        <input
          className="dd-input"
          placeholder="e.g. Alqasim Bello"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <label className="dd-label" style={{ marginTop: 16 }}>
          You're here to...
        </label>
        <div className="dd-role-grid">
          <button
            className={"dd-role-card" + (role === "owner" ? " active" : "")}
            onClick={() => setRole("owner")}
          >
            <Building2 size={20} />
            <div>
              <div className="dd-role-title">Sell / rent a property</div>
              <div className="dd-role-sub">List it, talk to buyers directly</div>
            </div>
          </button>
          <button
            className={"dd-role-card" + (role === "buyer" ? " active" : "")}
            onClick={() => setRole("buyer")}
          >
            <Search size={20} />
            <div>
              <div className="dd-role-title">Find a property</div>
              <div className="dd-role-sub">Browse listings, message owners</div>
            </div>
          </button>
          <button
            className={"dd-role-card" + (role === "admin" ? " active" : "")}
            onClick={() => setRole("admin")}
          >
            <ClipboardCheck size={20} />
            <div>
              <div className="dd-role-title">Review verifications</div>
              <div className="dd-role-sub">Platform team — approve or reject submitted documents</div>
            </div>
          </button>
        </div>

        <button
          className="dd-btn dd-btn-primary dd-onb-cta"
          disabled={!name.trim() || !role}
          onClick={() =>
            onDone({ id: uid(), name: name.trim(), role })
          }
        >
          Continue <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

/* ---------------- Top nav ---------------- */

function TopNav({ profile, view, setView, onSwitch, pendingCount }) {
  const roleLabel = { owner: "Owner", buyer: "Buyer", admin: "Admin" }[profile?.role] || "";
  return (
    <header className="dd-nav">
      <button className="dd-logo" onClick={() => setView(profile?.role === "admin" ? "admin" : "landing")}>
        <img src={LOGO_IMG} alt="Direct — Buy, Sell, Rent Directly From Owners" />
      </button>

      {profile && (
        <nav className="dd-nav-links">
          {profile.role === "admin" ? (
            <button
              className={"dd-nav-link" + (view === "admin" ? " on" : "")}
              onClick={() => setView("admin")}
            >
              Review queue{pendingCount > 0 ? ` (${pendingCount})` : ""}
            </button>
          ) : null}
          <button
            className={"dd-nav-link" + (view === "browse" ? " on" : "")}
            onClick={() => setView("browse")}
          >
            Browse
          </button>
          {profile.role === "owner" && (
            <>
              <button
                className={"dd-nav-link" + (view === "mine" ? " on" : "")}
                onClick={() => setView("mine")}
              >
                My listings
              </button>
              <button
                className="dd-btn dd-btn-primary dd-nav-cta"
                onClick={() => setView("create")}
              >
                <Plus size={15} /> List property
              </button>
            </>
          )}
          <div className="dd-nav-user">
            <span className="dd-nav-role">{roleLabel}</span>
            <span className="dd-nav-name">{profile.name}</span>
            <button className="dd-nav-switch" title="Switch profile" onClick={onSwitch}>
              <LogOut size={14} />
            </button>
          </div>
        </nav>
      )}
    </header>
  );
}

/* ---------------- Landing ---------------- */

function Landing({ profile, listings, onBrowse, onList, onOpen }) {
  const [price, setPrice] = useState(45000000);
  const cut = Math.round(price * AGENT_RATE);
  const featured = listings.slice(0, 3);
  const isOwner = profile.role === "owner";
  const features = [
    { Icon: Home, title: "Verified Listings", lines: ["Real owners.", "Real properties."] },
    { Icon: MessageCircle, title: "Direct Messaging", lines: ["Chat with owners", "in real-time."] },
    { Icon: ShieldCheck, title: "Secure Transactions", lines: ["Safe, transparent", "and reliable."] },
    { Icon: MapPin, title: "Location Based Search", lines: ["Find properties", "near you."] },
  ];

  return (
    <div className="dd-landing">
      <section className="dd-herox">
        <div className="dd-herox-photo" style={{ backgroundImage: `url(${HERO_IMG})` }} />
        <div className="dd-herox-inner">
          <div className="dd-herox-copy">
            <h1>
            Sell your property without the middleman,
              <span className="dd-accent">Keep every naira</span>
            </h1>
            <p className="dd-herox-sub">
              Connect directly with property owners. Discover verified properties,
              chat, negotiate and complete your deal — all on one trusted platform.
            </p>
            <div className="dd-hf-grid">
              {features.map(({ Icon, title, lines }) => (
                <div className="dd-hf" key={title}>
                  <div className="dd-hf-icon"><Icon size={19} /></div>
                  <div>
                    <div className="dd-hf-title">{title}</div>
                    <div className="dd-hf-sub">{lines[0]}<br />{lines[1]}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="dd-herox-cta">
              <button className="dd-btn dd-btn-primary dd-btn-lg" onClick={onBrowse}>
                Start Your Search <ArrowRight size={18} />
              </button>
              <div className="dd-herox-note">No Agents. No Extra Fees.<br />Just Direct Deals.</div>
            </div>
          </div>
        </div>
      </section>

      <section className="dd-sec">
        <div className="dd-wrap">
          <span className="dd-kicker">How it works</span>
          <h2 className="dd-sec-title">From listing to handshake, directly.</h2>
          <p className="dd-sec-sub">
            Three steps. No agent chain deciding what gets passed on, and no
            surprise percentage at the end.
          </p>
          <div className="dd-steps">
            <div className="dd-step">
              <div className="dd-step-num">1</div>
              <h3>List your property</h3>
              <p>Add photos, a video link, price and location. Submit your ownership documents to earn the Verified Owner badge.</p>
            </div>
            <div className="dd-step">
              <div className="dd-step-num">2</div>
              <h3>Get found by buyers</h3>
              <p>Buyers filter by state and property type, and can show only verified listings to browse with confidence.</p>
            </div>
            <div className="dd-step">
              <div className="dd-step-num">3</div>
              <h3>Talk and close directly</h3>
              <p>Chat on the listing itself, arrange a viewing and negotiate with the person who actually owns the property.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="dd-sec dd-sec-soft">
        <div className="dd-wrap dd-split">
          <div>
            <span className="dd-kicker">Why owners choose Direct</span>
            <h2 className="dd-sec-title">Keep what you worked for.</h2>
            <p className="dd-sec-sub" style={{ marginBottom: 0 }}>
              Agent commissions can take a large slice of a sale, sometimes shared
              across several agents. On Direct you deal with buyers yourself.
            </p>
            <ul className="dd-checks">
              <li>Zero commission on every deal</li>
              <li>Every listing shows its verification status</li>
              <li>Message buyers and owners without a go-between</li>
            </ul>
          </div>
          <div className="dd-calc">
            <div className="dd-calc-head">What you'd actually keep</div>
            <label className="dd-calc-label">Sale price</label>
            <input
              type="range" min="2000000" max="300000000" step="500000"
              value={price} onChange={(e) => setPrice(Number(e.target.value))}
              className="dd-slider"
            />
            <div className="dd-calc-price">{fmtNaira(price)}</div>
            <div className="dd-calc-row dd-calc-strike">
              <span>Typical agent commission (10%)</span><span>− {fmtNaira(cut)}</span>
            </div>
            <div className="dd-calc-row dd-calc-final">
              <span>Direct fee</span><span className="dd-stamp">₦0 · NO AGENTS</span>
            </div>
            <div className="dd-calc-row dd-calc-keep">
              <span>You keep</span><span>{fmtNaira(price)}</span>
            </div>
          </div>
        </div>
      </section>

      {featured.length > 0 && (
        <section className="dd-sec">
          <div className="dd-wrap">
            <div className="dd-section-head">
              <h2>Recently listed</h2>
              <button className="dd-link" onClick={onBrowse}>View all <ArrowRight size={14} /></button>
            </div>
            <div className="dd-grid">
              {featured.map((l) => (
                <ListingCard key={l.id} listing={l} onOpen={() => onOpen(l)} />
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="dd-sec" style={{ paddingTop: featured.length ? 0 : undefined }}>
        <div className="dd-wrap">
          <div className="dd-band">
            <h2>{isOwner ? "Ready to sell without the middleman?" : "Find your next property, directly."}</h2>
            <p>No Agents. No Extra Fees. Just Direct Deals.</p>
            <div className="dd-band-row">
              {isOwner ? (
                <button className="dd-btn dd-btn-primary dd-btn-lg" onClick={onList}>List your property</button>
              ) : (
                <button className="dd-btn dd-btn-primary dd-btn-lg" onClick={onBrowse}>Start Your Search</button>
              )}
              <button className="dd-btn dd-btn-light dd-btn-lg" onClick={onBrowse}>Browse listings</button>
            </div>
          </div>
        </div>
      </section>

      <footer className="dd-foot">
        <div className="dd-foot-inner">
          <img src={LOGO_IMG} alt="Direct" />
          <small>Buy • Sell • Rent Directly From Owners</small>
        </div>
      </footer>
    </div>
  );
}

/* ---------------- Browse ---------------- */

function Browse({ listings, loading, filters, setFilters, onOpen }) {
  const filtered = listings.filter((l) => {
    if (filters.state && l.location !== filters.state) return false;
    if (filters.type && l.type !== filters.type) return false;
    if (filters.q) {
      const q = filters.q.toLowerCase();
      if (!l.title.toLowerCase().includes(q) && !l.description.toLowerCase().includes(q)) return false;
    }
    if (filters.verifiedOnly && l.verification?.status !== "verified") return false;
    return true;
  });

  return (
    <div className="dd-browse">
      <div className="dd-filters">
        <div className="dd-search">
          <Search size={15} />
          <input
            placeholder="Search title or description..."
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
          />
        </div>
        <SelectPill
          value={filters.state}
          onChange={(v) => setFilters((f) => ({ ...f, state: v }))}
          placeholder="All locations"
          options={STATES}
        />
        <SelectPill
          value={filters.type}
          onChange={(v) => setFilters((f) => ({ ...f, type: v }))}
          placeholder="All types"
          options={TYPES}
        />
        <label className="dd-verified-toggle">
          <input
            type="checkbox"
            checked={filters.verifiedOnly}
            onChange={(e) => setFilters((f) => ({ ...f, verifiedOnly: e.target.checked }))}
          />
          <CheckCircle2 size={13} /> Verified only
        </label>
        {(filters.state || filters.type || filters.q || filters.verifiedOnly) && (
          <button
            className="dd-clear"
            onClick={() => setFilters({ state: "", type: "", q: "", verifiedOnly: false })}
          >
            Clear <X size={13} />
          </button>
        )}
      </div>

      {loading && (
        <div className="dd-empty"><Loader2 className="animate-spin" size={18} /> Loading listings…</div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="dd-empty">
          <Inbox size={22} />
          <p>Nothing matches yet. Try clearing a filter, or check back — new listings go up directly from owners.</p>
        </div>
      )}

      <div className="dd-grid">
        {filtered.map((l) => (
          <ListingCard key={l.id} listing={l} onOpen={() => onOpen(l)} />
        ))}
      </div>
    </div>
  );
}

function SelectPill({ value, onChange, placeholder, options }) {
  return (
    <div className="dd-select-wrap">
      <select
        className="dd-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      <ChevronDown size={13} className="dd-select-chev" />
    </div>
  );
}

function ListingCard({ listing, onOpen }) {
  return (
    <button className="dd-card" onClick={onOpen}>
      <div className="dd-card-img">
        {listing.images && listing.images[0] ? (
          <img src={listing.images[0]} alt={listing.title} />
        ) : (
          <div className="dd-card-noimg"><ImageIcon size={22} /></div>
        )}
        <span className="dd-card-type">{listing.type}</span>
      </div>
      <div className="dd-card-body">
        <VerifiedBadge status={listing.verification?.status || "unverified"} />
        <div className="dd-card-price">{fmtNaira(listing.price)}</div>
        <div className="dd-card-title">{listing.title}</div>
        <div className="dd-card-loc"><MapPin size={12} /> {listing.location}</div>
        <div className="dd-card-owner">Direct from {listing.ownerName}</div>
      </div>
    </button>
  );
}

/* ---------------- Detail ---------------- */

function Detail({ listing, profile, onBack, onMessage }) {
  const [imgIdx, setImgIdx] = useState(0);
  const images = listing.images && listing.images.length ? listing.images : [];
  const isOwner = listing.ownerId === profile.id;

  return (
    <div className="dd-detail">
      <button className="dd-link dd-back" onClick={onBack}><ArrowLeft size={14} /> Back to browse</button>

      <div className="dd-detail-grid">
        <div>
          <div className="dd-gallery">
            {images.length > 0 ? (
              <img src={images[imgIdx]} alt={listing.title} />
            ) : (
              <div className="dd-card-noimg dd-gallery-empty"><ImageIcon size={28} /></div>
            )}
          </div>
          {images.length > 1 && (
            <div className="dd-thumbs">
              {images.map((im, i) => (
                <button
                  key={i}
                  className={"dd-thumb" + (i === imgIdx ? " on" : "")}
                  onClick={() => setImgIdx(i)}
                >
                  <img src={im} alt="" />
                </button>
              ))}
            </div>
          )}
          {listing.videoUrl && (
            <a className="dd-video-link" href={listing.videoUrl} target="_blank" rel="noreferrer">
              <Video size={14} /> Watch video walkthrough
            </a>
          )}

          <h1 className="dd-detail-title">{listing.title}</h1>
          <div className="dd-detail-meta">
            <span><MapPin size={13} /> {listing.location}</span>
            <span>{listing.type}</span>
            {listing.bedrooms ? <span>{listing.bedrooms} bed</span> : null}
            {listing.bathrooms ? <span>{listing.bathrooms} bath</span> : null}
          </div>
          <p className="dd-detail-desc">{listing.description}</p>
        </div>

        <aside className="dd-detail-side">
          <div className="dd-price-box">
            <VerifiedBadge status={listing.verification?.status || "unverified"} size={13} />
            <div className="dd-price-box-amount">{fmtNaira(listing.price)}</div>
            <div className="dd-price-box-fee"><Check size={13} /> No agent fee on this deal</div>
          </div>
          {listing.verification?.status !== "verified" && (
            <div className="dd-note dd-warn-note">
              <AlertTriangle size={13} /> This listing hasn't completed document verification yet. Meet in a public place, confirm the title documents yourself, and never send money before viewing.
            </div>
          )}
          <div className="dd-owner-box">
            <div className="dd-owner-avatar"><User size={16} /></div>
            <div>
              <div className="dd-owner-name">{listing.ownerName}</div>
              <div className="dd-owner-sub">Property owner · listed {timeAgo(listing.createdAt)}</div>
            </div>
          </div>
          {!isOwner && (
            <button className="dd-btn dd-btn-primary dd-full" onClick={onMessage}>
              <MessageCircle size={16} /> Message {listing.ownerName.split(" ")[0]}
            </button>
          )}
          {isOwner && (
            <div className="dd-note">This is your listing. Buyer messages appear under My Listings.</div>
          )}
        </aside>
      </div>
    </div>
  );
}

/* ---------------- Create listing ---------------- */

function CreateListing({ profile, onDone }) {
  const [form, setForm] = useState({
    title: "", description: "", price: "", location: "", type: "",
    bedrooms: "", bathrooms: "", videoUrl: "",
  });
  const [images, setImages] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []).slice(0, 4 - images.length);
    const compressed = await Promise.all(files.map((f) => compressImage(f)));
    setImages((prev) => [...prev, ...compressed].slice(0, 4));
  }

  async function submit() {
    if (!form.title.trim() || !form.price || !form.location || !form.type) {
      setErr("Title, price, location and type are required.");
      return;
    }
    setErr("");
    setSaving(true);
    const id = "listing:" + uid();
    const payload = {
      id,
      ownerId: profile.id,
      ownerName: profile.name,
      title: form.title.trim(),
      description: form.description.trim(),
      price: Number(form.price),
      location: form.location,
      type: form.type,
      bedrooms: form.bedrooms,
      bathrooms: form.bathrooms,
      videoUrl: form.videoUrl.trim(),
      images,
      createdAt: Date.now(),
      verification: { status: "unverified", docs: [], note: "", submittedAt: null, reviewedAt: null, reviewNote: "" },
    };
    const ok = await safeSet(id, JSON.stringify(payload), true);
    setSaving(false);
    if (!ok) { setErr("Couldn't publish — check your connection and try again."); return; }
    onDone(payload);
  }

  return (
    <div className="dd-create">
      <h1 className="dd-page-title">List your property</h1>
      <p className="dd-page-sub">Everything a buyer needs to trust it's real — no agent required.</p>

      <div className="dd-form">
        <Field label="Title">
          <input className="dd-input" placeholder="e.g. 4-Bedroom Duplex, Guzape"
            value={form.title} onChange={(e) => set("title", e.target.value)} />
        </Field>

        <Field label="Description">
          <textarea className="dd-input dd-textarea" rows={5}
            placeholder="Describe the property honestly — condition, land title, what's nearby, why you're selling."
            value={form.description} onChange={(e) => set("description", e.target.value)} />
        </Field>

        <div className="dd-form-row">
          <Field label="Price (₦)">
            <input className="dd-input" type="number" placeholder="45000000"
              value={form.price} onChange={(e) => set("price", e.target.value)} />
          </Field>
          <Field label="Location (state)">
            <select className="dd-input" value={form.location} onChange={(e) => set("location", e.target.value)}>
              <option value="">Select state</option>
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>

        <div className="dd-form-row">
          <Field label="Property type">
            <select className="dd-input" value={form.type} onChange={(e) => set("type", e.target.value)}>
              <option value="">Select type</option>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Bedrooms (optional)">
            <input className="dd-input" type="number" placeholder="e.g. 4"
              value={form.bedrooms} onChange={(e) => set("bedrooms", e.target.value)} />
          </Field>
          <Field label="Bathrooms (optional)">
            <input className="dd-input" type="number" placeholder="e.g. 3"
              value={form.bathrooms} onChange={(e) => set("bathrooms", e.target.value)} />
          </Field>
        </div>

        <Field label="Video link (optional)">
          <input className="dd-input" placeholder="YouTube / Drive link to a walkthrough"
            value={form.videoUrl} onChange={(e) => set("videoUrl", e.target.value)} />
        </Field>

        <Field label={`Photos (${images.length}/4)`}>
          <div className="dd-uploads">
            {images.map((im, i) => (
              <div className="dd-upload-thumb" key={i}>
                <img src={im} alt="" />
                <button onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}>
                  <X size={12} />
                </button>
              </div>
            ))}
            {images.length < 4 && (
              <label className="dd-upload-add">
                <ImageIcon size={18} />
                <span>Add photo</span>
                <input type="file" accept="image/*" multiple onChange={handleFiles} hidden />
              </label>
            )}
          </div>
        </Field>

        {err && <div className="dd-error">{err}</div>}

        <button className="dd-btn dd-btn-primary dd-full" disabled={saving} onClick={submit}>
          {saving ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
          {saving ? "Publishing…" : "Publish listing"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="dd-field">
      <label className="dd-label">{label}</label>
      {children}
    </div>
  );
}

/* ---------------- My listings (owner) ---------------- */

function MyListings({ profile, listings, loading, onOpenChat, onDelete, onList, onRefresh, flash }) {
  const [expanded, setExpanded] = useState(null);
  const [threads, setThreads] = useState({}); // listingId -> [{buyerId, buyerName, last}]
  const [threadsLoading, setThreadsLoading] = useState(false);

  async function loadThreads(listing) {
    setThreadsLoading(true);
    const keys = await safeList(`chat:${listing.id}:`, true);
    const items = [];
    for (const k of keys) {
      const raw = await safeGet(k, true);
      if (!raw) continue;
      try {
        const msgs = JSON.parse(raw);
        if (!msgs.length) continue;
        const buyerId = k.split(":")[2];
        const buyerMsg = [...msgs].reverse().find((m) => m.sender === "buyer");
        const last = msgs[msgs.length - 1];
        items.push({
          buyerId,
          buyerName: buyerMsg ? buyerMsg.senderName : "Buyer",
          lastText: last.text,
          lastTs: last.ts,
        });
      } catch (e) {}
    }
    items.sort((a, b) => b.lastTs - a.lastTs);
    setThreads((t) => ({ ...t, [listing.id]: items }));
    setThreadsLoading(false);
  }

  function toggle(listing) {
    if (expanded === listing.id) { setExpanded(null); return; }
    setExpanded(listing.id);
    loadThreads(listing);
  }

  return (
    <div className="dd-mine">
      <div className="dd-section-head">
        <h1 className="dd-page-title">My listings</h1>
        <button className="dd-btn dd-btn-primary" onClick={onList}><Plus size={15} /> New listing</button>
      </div>

      {loading && <div className="dd-empty"><Loader2 className="animate-spin" size={18} /> Loading…</div>}

      {!loading && listings.length === 0 && (
        <div className="dd-empty">
          <Building2 size={22} />
          <p>You haven't listed anything yet. Buyers can't find what isn't posted.</p>
          <button className="dd-btn dd-btn-primary" onClick={onList}>List your first property</button>
        </div>
      )}

      <div className="dd-mine-list">
        {listings.map((l) => (
          <div className="dd-mine-item" key={l.id}>
            <button className="dd-mine-row" onClick={() => toggle(l)}>
              <div className="dd-mine-img">
                {l.images && l.images[0] ? <img src={l.images[0]} alt="" /> : <ImageIcon size={16} />}
              </div>
              <div className="dd-mine-info">
                <div className="dd-mine-title">{l.title}</div>
                <div className="dd-mine-sub">{fmtNaira(l.price)} · {l.location}</div>
              </div>
              <VerifiedBadge status={l.verification?.status || "unverified"} />
              <ChevronDown size={16} className={"dd-chev" + (expanded === l.id ? " up" : "")} />
            </button>

            {expanded === l.id && (
              <div className="dd-mine-panel">
                <VerifyPanel listing={l} onRefresh={onRefresh} flash={flash} />

                <div className="dd-mine-panel-head" style={{ marginTop: 18 }}>
                  <span>Conversations</span>
                  <button className="dd-danger-link" onClick={() => onDelete(l.id)}>
                    <Trash2 size={13} /> Remove listing
                  </button>
                </div>
                {threadsLoading && <div className="dd-empty small"><Loader2 className="animate-spin" size={15} /> Loading messages…</div>}
                {!threadsLoading && (threads[l.id] || []).length === 0 && (
                  <div className="dd-empty small">No messages yet on this listing.</div>
                )}
                {(threads[l.id] || []).map((t) => (
                  <button
                    key={t.buyerId}
                    className="dd-thread"
                    onClick={() => onOpenChat(l, t.buyerId, t.buyerName)}
                  >
                    <div className="dd-thread-avatar"><User size={14} /></div>
                    <div className="dd-thread-body">
                      <div className="dd-thread-name">{t.buyerName}</div>
                      <div className="dd-thread-last">{t.lastText}</div>
                    </div>
                    <div className="dd-thread-time">{timeAgo(t.lastTs)}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Verification (owner side) ---------------- */

function VerifyPanel({ listing, onRefresh, flash }) {
  const v = listing.verification || { status: "unverified" };
  const [docs, setDocs] = useState([]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []).slice(0, 3 - docs.length);
    const compressed = await Promise.all(files.map((f) => compressImage(f, 1100, 0.6)));
    setDocs((prev) => [...prev, ...compressed].slice(0, 3));
  }

  async function submit() {
    if (docs.length === 0) return;
    setSubmitting(true);
    const updated = {
      ...listing,
      verification: {
        status: "pending",
        docs,
        note: note.trim(),
        submittedAt: Date.now(),
        reviewedAt: null,
        reviewNote: "",
      },
    };
    await safeSet(listing.id, JSON.stringify(updated), true);
    setSubmitting(false);
    setEditing(false);
    setDocs([]);
    setNote("");
    flash && flash("Documents submitted — review usually takes a day or two.");
    onRefresh && onRefresh();
  }

  return (
    <div className="dd-verify-box">
      <div className="dd-mine-panel-head">
        <span>Verification</span>
        <VerifiedBadge status={v.status} />
      </div>

      {v.status === "verified" && (
        <p className="dd-verify-note">Approved. Buyers see this listing marked as verified.</p>
      )}

      {v.status === "pending" && (
        <p className="dd-verify-note">Submitted {timeAgo(v.submittedAt)} — waiting on review.</p>
      )}

      {v.status === "rejected" && v.reviewNote && (
        <div className="dd-warn-note dd-note">
          <AlertTriangle size={13} /> Sent back: {v.reviewNote}
        </div>
      )}

      {(v.status === "unverified" || v.status === "rejected") && !editing && (
        <button className="dd-btn dd-btn-ghost" onClick={() => setEditing(true)}>
          <Upload size={14} /> Submit documents for verification
        </button>
      )}

      {editing && (
        <div className="dd-verify-form">
          <p className="dd-verify-hint">
            Upload a photo of your Certificate of Occupancy / Deed of Assignment and a valid ID.
            These are only used to confirm you own this property — they don't appear on the public listing.
          </p>
          <div className="dd-uploads">
            {docs.map((im, i) => (
              <div className="dd-upload-thumb" key={i}>
                <img src={im} alt="" />
                <button onClick={() => setDocs((prev) => prev.filter((_, idx) => idx !== i))}>
                  <X size={12} />
                </button>
              </div>
            ))}
            {docs.length < 3 && (
              <label className="dd-upload-add">
                <FileCheck2 size={18} />
                <span>Add document</span>
                <input type="file" accept="image/*" multiple onChange={handleFiles} hidden />
              </label>
            )}
          </div>
          <textarea
            className="dd-input dd-textarea"
            rows={2}
            placeholder="Anything the reviewer should know (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{ marginTop: 10 }}
          />
          <div className="dd-verify-actions">
            <button className="dd-btn dd-btn-ghost" onClick={() => { setEditing(false); setDocs([]); }}>Cancel</button>
            <button className="dd-btn dd-btn-primary" disabled={docs.length === 0 || submitting} onClick={submit}>
              {submitting ? <Loader2 className="animate-spin" size={15} /> : <Upload size={15} />}
              {submitting ? "Submitting…" : "Submit for review"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Admin review queue ---------------- */

function AdminQueue({ listings, loading, onDecision }) {
  const pending = listings.filter((l) => l.verification?.status === "pending");
  const decided = listings.filter((l) => ["verified", "rejected"].includes(l.verification?.status)).slice(0, 12);
  const [open, setOpen] = useState(null);

  return (
    <div className="dd-admin">
      <h1 className="dd-page-title">Review queue</h1>
      <p className="dd-page-sub">
        Confirm each owner's documents before a listing shows as verified to buyers.
      </p>

      {loading && <div className="dd-empty"><Loader2 className="animate-spin" size={18} /> Loading…</div>}

      {!loading && pending.length === 0 && (
        <div className="dd-empty">
          <ClipboardCheck size={22} />
          <p>Nothing waiting on review right now.</p>
        </div>
      )}

      <div className="dd-admin-list">
        {pending.map((l) => (
          <AdminCard key={l.id} listing={l} open={open === l.id} onToggle={() => setOpen(open === l.id ? null : l.id)} onDecision={onDecision} />
        ))}
      </div>

      {decided.length > 0 && (
        <>
          <h2 className="dd-admin-subhead">Recently decided</h2>
          <div className="dd-admin-list">
            {decided.map((l) => (
              <div className="dd-admin-decided-row" key={l.id}>
                <span>{l.title}</span>
                <VerifiedBadge status={l.verification.status} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AdminCard({ listing, open, onToggle, onDecision }) {
  const [reason, setReason] = useState("");
  const v = listing.verification;

  return (
    <div className="dd-admin-card">
      <button className="dd-mine-row" onClick={onToggle}>
        <div className="dd-mine-img">
          {listing.images && listing.images[0] ? <img src={listing.images[0]} alt="" /> : <ImageIcon size={16} />}
        </div>
        <div className="dd-mine-info">
          <div className="dd-mine-title">{listing.title}</div>
          <div className="dd-mine-sub">{listing.ownerName} · submitted {timeAgo(v.submittedAt)}</div>
        </div>
        <ChevronDown size={16} className={"dd-chev" + (open ? " up" : "")} />
      </button>

      {open && (
        <div className="dd-mine-panel">
          {v.note && <p className="dd-verify-note">Owner note: {v.note}</p>}
          <div className="dd-uploads">
            {(v.docs || []).map((im, i) => (
              <a href={im} target="_blank" rel="noreferrer" className="dd-upload-thumb dd-doc-view" key={i}>
                <img src={im} alt="" />
              </a>
            ))}
          </div>
          <textarea
            className="dd-input dd-textarea"
            rows={2}
            placeholder="Reason if sending back (shown to owner)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ marginTop: 12 }}
          />
          <div className="dd-verify-actions">
            <button className="dd-btn dd-btn-ghost dd-reject-btn" onClick={() => onDecision(listing, "rejected", reason || "Documents unclear — please resubmit.")}>
              <XCircle size={15} /> Send back
            </button>
            <button className="dd-btn dd-btn-primary" onClick={() => onDecision(listing, "verified", "")}>
              <CheckCircle2 size={15} /> Approve
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Chat ---------------- */

function ChatRoom({ chat, profile, onBack }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef(null);
  const key = `chat:${chat.listingId}:${chat.buyerId}`;

  const load = useCallback(async () => {
    const raw = await safeGet(key, true);
    if (raw) {
      try { setMessages(JSON.parse(raw)); } catch (e) {}
    }
    setLoading(false);
  }, [key]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    if (!text.trim()) return;
    const msg = {
      sender: profile.role,
      senderName: profile.name,
      text: text.trim(),
      ts: Date.now(),
    };
    const next = [...messages, msg];
    setMessages(next);
    setText("");
    await safeSet(key, JSON.stringify(next), true);
  }

  const otherName = profile.role === "owner" ? chat.buyerName : chat.ownerName;

  return (
    <div className="dd-chat">
      <button className="dd-link dd-back" onClick={onBack}><ArrowLeft size={14} /> Back</button>

      <div className="dd-chat-box">
        <div className="dd-chat-head">
          <div className="dd-owner-avatar"><User size={15} /></div>
          <div>
            <div className="dd-chat-name">{otherName}</div>
            <div className="dd-chat-sub">re: {chat.listingTitle}</div>
          </div>
        </div>

        <div className="dd-chat-msgs">
          {loading && <div className="dd-empty small"><Loader2 className="animate-spin" size={15} /> Loading conversation…</div>}
          {!loading && messages.length === 0 && (
            <div className="dd-empty small">
              No messages yet. Say hello — ask about the title, viewing, or price.
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={"dd-msg" + (m.sender === profile.role ? " mine" : "")}>
              <div className="dd-msg-bubble">{m.text}</div>
              <div className="dd-msg-time">{timeAgo(m.ts)}</div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="dd-chat-input">
          <input
            placeholder="Write a message…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          />
          <button onClick={send} disabled={!text.trim()}><Send size={16} /></button>
        </div>
      </div>
    </div>
  );
}
