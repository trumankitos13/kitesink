/* ===================== KiteSink portfolio =====================
   The Work (/work.html) and Games (/games.html) index pages render from this
   one file. Everything is one of TWO kinds:

     • internal ("mine")  — built & hosted here; links to a page on the site.
     • external           — a link out (a tool I recommend / a game I love);
                            opens in a new tab.

   To grow either page, add an object to the matching list below. Leave a list
   empty and that section shows a short "more coming" invite instead of cards —
   the framework is always there, ready for the next entry.
   ============================================================== */

/* ---- WORK: everything I've built (mine) + outside tools I recommend (external) ---- */
window.KS_WORK = {
  mine: [
    {
      title: "Song of the Day",
      href: "/song-of-the-day.html",
      icon: "music",                 // music | tent | bars  (inline SVGs live in work.html)
      status: "LIVE",               // status pill text; set wip:true for the tan WIP styling
      wip: false,
      category: "iOS APP",
      cta: "App Store",             // CTA label — an ↗ is always appended
      dek: "One song, every day — a daily recommendation with the story behind it and links to listen. Landing page, privacy & contact built in.",
      tags: [],                      // optional feature pills (see Vantix)
      related: []                    // optional chits: { kind:"ESSAY"|"DEVLOG"|"FEATURED", title, href }
    },
    {
      title: "Campground Tycoon",
      href: "/campground-tycoon.html",
      icon: "tent",
      status: "LIVE · DEMO",
      wip: false,
      category: "GAME",
      cta: "Play demo",
      dek: "Build and run a campground anywhere you like. Play the lite version right in the browser; the full release links out to the stores.",
      tags: [],
      related: [
        { kind: "DEVLOG", title: "Campground Tycoon: the story so far", href: "/blog/campground-tycoon-the-story-so-far.html" }
      ]
    },
    {
      title: "Vantix",
      href: "/vantix.html",
      icon: "bars",
      status: "WIP",
      wip: true,                     // tan dot + tan accents + the gradient row tint
      category: "FITNESS OS · FLAGSHIP",
      cta: "vantix.kitesink.com",
      dek: "A personal fitness OS for advanced lifters who outgrew simple trackers — data normalization, mesocycle-aware volume, and a unified view across training, nutrition & health.",
      tags: ["normalization", "mesocycle volume", "full front-end app"],
      related: []
    },
    {
      title: "Backline",
      href: "/backline.html",
      icon: "amp",
      status: "WIP · PROTOTYPE",
      wip: true,                     // tan dot + tan accents + the gradient row tint
      category: "MUSIC APP",
      cta: "backline.kitesink.com",
      dek: "Your scene, on call — a local-first network for musicians, bands, venues & gig techs. Find a sub, watch their reel, book them and pay them, all before the downbeat. SOS mode for when you need someone on stage tonight.",
      tags: ["SOS mode", "reels", "book & pay"],
      related: []
    }
  ],

  /* Outside tools I recommend. Empty by design — add your picks here.
     Template:
       {
         name: "Claude", url: "https://claude.ai", letter: "C",
         category: "AI · PAIR",
         why: "My everyday build pair — design, code, and writing.",
         related: [ { kind: "ESSAY", title: "Building alone, with a machine", href: "/blog/…" } ]
       } */
  external: []
};

/* ---- GAMES: my games (mine) + games I love (external) ---- */
window.KS_GAMES = {
  mine: [
    {
      title: "Campground Tycoon",
      href: "/campground-tycoon.html",
      demoHref: "/campground-tycoon.html#demo",
      wishlistUrl: "",               // external store URL once live; "" falls back to the product page
      eyebrow: "Isometric tycoon sim",
      status: "LIVE · DEMO",
      platforms: "PC · iOS · ANDROID",
      dek: "Buy a scrap of wilderness, pitch a few tents, and keep campers happy through four fickle seasons. 15 regions, procedural land, anglers, hunters & leaf-peepers — and a deeply chunky CRT booking terminal. Play the lite version right in the browser.",
      related: [
        { kind: "DEVLOG", title: "Campground Tycoon: the story so far", href: "/blog/campground-tycoon-the-story-so-far.html" }
      ]
    }
  ],

  /* Games I love. Empty by design — add recommendations here.
     Template:
       {
         name: "Stardew Valley", studio: "ConcernedApe", year: "2016",
         genre: "FARM SIM", letter: "S", color: "#2f5436",
         take: "One person, four years, a genre redefined.",
         url: "https://www.stardewvalley.net"
       } */
  external: []
};
