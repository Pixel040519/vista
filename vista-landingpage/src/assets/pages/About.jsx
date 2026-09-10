// src/pages/About.jsx
import React from 'react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PageHeader from '../components/PageHeader';
import { Label, Icon, IconTile, SECTION, HEADING } from '../components/ui';

// Vision, as it is set out in Section 3 of the Students' Handbook: four groups,
// not one flat list.
const vision = [
  {
    lead: 'As a learner with',
    items: ['An inquisitive mind', 'A compassionate heart', 'Creative hands', 'Agile footsteps'],
  },
  {
    lead: 'As a person who',
    items: [
      'Believes in and realizes his/her own worth',
      'Values and cares for his/her family',
      'Appreciates and honors his/her alma mater',
      'Contributes to and excels in his/her chosen field',
    ],
  },
  {
    lead: 'As an advocate who promotes',
    items: [
      'Integrity and excellence in oneself',
      'Love and harmony in the home',
      'Proactivity and self-sufficiency in the community',
      'Peace and equity in the world',
    ],
  },
  {
    lead: 'As a steward who',
    items: [
      'Treasures the past for the valuable lessons it contributes',
      'Lives the present for the enriching experiences it offers',
      'Prepares for the future for the better opportunities it promises',
      'Maximizes every moment for the essence of life lies in it',
    ],
  },
];

const mission = [
  'To offer the Yorklinians a rich and rigorous curriculum designed to stimulate creative inquiry, intellectual achievements, ethical decisions, and prompt actions, in a world united by commonalities and enriched by diversity.',
  'To support them to go beyond their limits in athletics and to go in-depth in expressing their artistic abilities.',
  'To challenge them to unleash their intellectual potentials and set higher ethical standards.',
  'To enjoin them to be proactive in taking stewardship of the natural world and in improving themselves to be of service to others.',
];

// Section 4 of the Students' Handbook, verbatim.
const principles = [
  {
    glyph: '智',
    name: 'Knowledge',
    body: 'Knowledge is the awareness or understanding of facts, information, and skills which are acquired through experiential learning. This opens wide the door for every Yorklinian to take part responsibly in the world.',
  },
  {
    glyph: '仁',
    name: 'Benevolence',
    body: 'Benevolence is not simply an act of kindness. Rather, it is the innermost desire to do good towards humanity. A Yorklinian is service-oriented.',
  },
  {
    glyph: '勇',
    name: 'Courage',
    body: 'Courage is the will to face and tackle challenges of the world. A Yorklinian is equipped with moral courage to act rightfully in every decision he/she will make.',
  },
];

const history = [
  'This institution, then known as Philippine Chinese Yok Lin School, was established in 1939 by a group of Chinese businessmen. Yok Lin was then housed in a borrowed residence along Julian Teodoro St., Caloocan City.',
  'When the Pacific War broke out in 1941, Yorklin stopped its operation and many Yorklin teachers and students joined and sacrificed their lives in fighting the Japanese.',
  'When the war ended in 1945, the businessmen found a building in the riverbank of Malabon St., started classes, and held the first graduation ceremony for elementary in 1946.',
  'The great increase in the enrollment prompted the founders to rent a portion in the then fast developing Grace Park, Caloocan City to serve as a Yoklin Branch. The founders, seeing the continuous increase in the enrollment of both schools, decided to look for another lot and construct a new school building, hence, a new building was inaugurated in 1947, at the present address, to conduct classes for the students of the two campuses.',
  'The first kindergarten classes were held in 1958, high school classes started in 1977; and the school was named Northern Rizal Yorklin School.',
  'The latest was the implementation of the K to 12 basic education which added two years of senior high school starting school year 2012-2013.',
];

const preface = [
  'Yorklin is a Chinese-Filipino school, expectedly, we integrate the best of the two cultures, with nurturing knowledge, benevolence, and courage as the core of its education.',
  'To ensure that we, the administrators, faculty, staff, parents, students and other stakeholders, share a common vision, carry out and serve the same mission, and are guided by standard policies and procedures, hence the creation of this Yorklin Student Handbook.',
  'In knowing the content of this handbook, students will be guided and be inspired to actively perform their duties and responsibilities as Yorklinians. For the parents, the institution hopes to collaborate and build a strong partnership with them for the continuing growth and development of their children. For the teachers, this handbook will be a reference in the implementation of the school policies, rules and regulations in line with the vision-mission of the school. And for the other stakeholders, this will serve as a guide on how you can work hand in hand with us for the development of the institution as a pillar for nation building and a cradle for future leaders of the world.',
];

const About = () => (
  <div className="flex min-h-screen flex-col bg-white font-sans text-slate-800 selection:bg-yellow-300 selection:text-[#002855] dark:bg-[#00152e] dark:text-slate-100">
    <Navbar />

    <main className="flex-grow">
      <PageHeader
        eyebrow="Our heritage and identity"
        title="About the school"
        lede="Northern Rizal Yorklin School has stood on C. Cordero Street since 1939, integrating the best of Chinese and Filipino cultures with knowledge, benevolence and courage at the core of its education."
      />

      {/* PREFACE */}
      <section className="selectable bg-white dark:bg-[#00152e]">
        <div className={SECTION}>
          <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr] lg:gap-20">
            <div>
              <IconTile className="mb-5">
                <Icon>
                  <path d="M12 6.5C10.5 5 8.5 4.5 4 4.5v13c4.5 0 6.5.5 8 2 1.5-1.5 3.5-2 8-2v-13c-4.5 0-6.5.5-8 2z" />
                  <path d="M12 6.5v13" />
                </Icon>
              </IconTile>
              <Label className="mb-3 block text-slate-500 dark:text-slate-400">Preface</Label>
              <h2 className={HEADING}>Two cultures, one education</h2>
            </div>
            <div className="flex flex-col gap-5 text-lg leading-relaxed text-slate-600 dark:text-slate-300">
              {preface.map((p) => (
                <p key={p.slice(0, 40)}>{p}</p>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* BRIEF HISTORY */}
      <section className="selectable border-y border-slate-200 bg-[#F0F4F8] dark:border-white/10 dark:bg-[#001f44]">
        <div className={SECTION}>
          <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr] lg:gap-20">
            <div>
              <IconTile className="mb-5">
                <Icon>
                  <path d="M3 21h18M4 21V10l8-6 8 6v11" />
                  <path d="M9 21v-6h6v6" />
                </Icon>
              </IconTile>
              <Label className="mb-3 block text-slate-500 dark:text-slate-400">Brief history</Label>
              <h2 className={HEADING}>Since 1939</h2>
            </div>
            <div className="flex flex-col gap-5 text-lg leading-relaxed text-slate-600 dark:text-slate-300">
              {history.map((p) => (
                <p key={p.slice(0, 40)}>{p}</p>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* VISION & MISSION */}
      <section id="vision" className="selectable scroll-mt-24 bg-white dark:bg-[#00152e]">
        <div className={SECTION}>
          <Label className="mb-3 block text-slate-500 dark:text-slate-400">Vision and mission</Label>
          <h2 className={`${HEADING} mb-12`}>What we are working towards</h2>

          <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <div className="mb-6 flex items-center gap-3">
                <IconTile>
                  <Icon>
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </Icon>
                </IconTile>
                <h3 className="text-xl font-semibold text-[#001f3f] dark:text-white">Vision</h3>
              </div>
              <p className="mb-8 text-lg font-medium text-[#001f3f] dark:text-yellow-400">
                We envision a Yorklinian&hellip;
              </p>

              <div className="flex flex-col gap-7">
                {vision.map((group) => (
                  <div key={group.lead}>
                    <Label className="mb-3 block text-slate-500 dark:text-slate-400">
                      {group.lead}
                    </Label>
                    <ul className="flex list-none flex-col gap-2 p-0">
                      {group.items.map((item) => (
                        <li key={item} className="flex items-start gap-3">
                          <span
                            aria-hidden="true"
                            className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-yellow-400"
                          />
                          <span className="leading-relaxed text-slate-600 dark:text-slate-300">
                            {item}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-6 flex items-center gap-3">
                <IconTile>
                  <Icon>
                    <circle cx="12" cy="12" r="9" />
                    <circle cx="12" cy="12" r="5" />
                    <circle cx="12" cy="12" r="1" />
                  </Icon>
                </IconTile>
                <h3 className="text-xl font-semibold text-[#001f3f] dark:text-white">Mission</h3>
              </div>
              <ul className="flex list-none flex-col gap-6 p-0">
                {mission.map((m) => (
                  <li
                    key={m.slice(0, 40)}
                    className="border-l-2 border-yellow-400 pl-5 text-lg leading-relaxed text-slate-600 dark:text-slate-300"
                  >
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* THE GUIDING PRINCIPLES */}
      <section className="selectable bg-[#001f3f] text-white dark:bg-[#001024]">
        <div className={SECTION}>
          <Label className="mb-3 block text-yellow-400">The guiding principles</Label>
          <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
            Yorklinians are guided by these three principles
          </h2>
          <p className="mb-12 max-w-2xl text-lg leading-relaxed text-slate-300">
            They are the three words on the school seal, and they are what the school sets out to
            build in every learner.
          </p>

          <div className="grid gap-6 md:grid-cols-3">
            {principles.map((p) => (
              <div
                key={p.name}
                className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/5 p-7"
              >
                <span
                  className="text-5xl leading-none text-yellow-400"
                  style={{ WebkitTextStroke: '0.4px currentColor' }}
                >
                  {p.glyph}
                </span>
                <h3 className="text-xl font-semibold">{p.name}</h3>
                <p className="leading-relaxed text-slate-300">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SCHOOL HYMN */}
      <section className="selectable border-y border-slate-200 bg-[#F0F4F8] dark:border-white/10 dark:bg-[#001f44]">
        <div className={SECTION}>
          <div className="mx-auto max-w-2xl text-center">
            <Label className="mb-3 block text-slate-500 dark:text-slate-400">School hymn</Label>
            <h2 className={`${HEADING} mb-10`}>Oh mighty Yorklin</h2>
            <p className="text-lg leading-loose text-[#001f3f] italic dark:text-slate-200 sm:text-xl">
              Oh mighty YORKLIN mother dear
              <br />
              Pride of the Orient Sea
              <br />
              Youth come from thy bosom with integrity
              <br />
              Onwards to serve society
            </p>
            <p className="mt-8 text-lg leading-loose text-[#001f3f] italic dark:text-slate-200 sm:text-xl">
              Hear the chanting hymn of classics
              <br />
              See the molding soul of epic
              <br />
              Blending the west with the east code of ethics
              <br />
              Culminating thy peak
            </p>
          </div>
        </div>
      </section>
    </main>

    <Footer />
  </div>
);

export default About;
