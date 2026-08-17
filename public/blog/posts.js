/* ===================== KiteSink blog entries =====================
   SINGLE SOURCE OF TRUTH for the blog. Loaded by /blog (the full index)
   and by the home page's "From the log" section. Newest first.

   TWO kinds of entry:

   1) MINE — an essay I wrote. Also needs its own page under /blog/
      (copy public/blog/_template.html). Fields:
        cat, date "YYYY.MM.DD", read "N min", title, dek (one-line summary),
        href "/blog/slug", featured (optional; true = big card on top).

   2) EXTERNAL — a repost / link to someone else's writing. No page needed.
      Set external:true and give it `url` + `source` instead of `href`. Fields:
        external:true, cat, date, read (optional — the piece's length),
        title, source "Publication or Author", url "https://…",
        dek (what it's about), note (optional — WHY I'm featuring it).
      External items render in brass with an ↗ and open in a new tab.

   `cat` may be a single string OR an array of strings for multiple categories,
   e.g.  cat: ["Devlog", "Gaming"]  — the entry then shows under every one of
   those filter chips. See docs/ADDING-A-BLOG-POST.md for the full steps.
   ================================================================= */
window.KS_POSTS = [
  {
    cat: ["Devlog", "Gaming"], date: "2026.06.24", read: "7 min",
    title: "Campground Tycoon: the story so far",
    dek: "From a static campground to a living valley in under two weeks — eighteen updates, the milestones, and what's next.",
    href: "/blog/campground-tycoon-the-story-so-far", featured: true
  },
  // EXAMPLE repost — edit the note/url or delete this entry. Shows how an
  // external link renders (brass, ↗, with a "why I'm featuring it" blurb).
  {
    external: true, cat: "Reading", date: "2026.06.20", read: "30 min",
    title: "How to Do Great Work",
    source: "Paul Graham",
    url: "https://paulgraham.com/greatwork.html",
    dek: "A field guide to doing work that matters, assembled from how the most productive people actually operate.",
    note: "The best single thing I've read on following curiosity instead of a plan. Worth a re-read every few months."
  }
  // Add older items below (newest first). Templates:
  // MINE:     { cat:"Training", date:"2026.07.01", read:"6 min", title:"…", dek:"…", href:"/blog/slug", featured:true }
  // MULTI:    { cat:["Devlog","Gaming"], date:"…", read:"…", title:"…", dek:"…", href:"/blog/slug" }
  // EXTERNAL: { external:true, cat:"AI", date:"…", read:"12 min", title:"…", source:"…", url:"https://…", dek:"…", note:"why I'm sharing it" }
];
