// src/pages/Programs.jsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PageHeader from '../components/PageHeader';
import { Label, Icon, IconTile, SECTION, HEADING } from '../components/ui';
import EnrollCta from '../components/EnrollCta';

const academicLevels = [
  {
    id: 'tots',
    title: 'Tots (Preschool)',
    levels: 'Pre-Nursery, Nursery, Kinder',
    description:
      'A nurturing environment focusing on early childhood development, social skills, and foundational learning through play and discovery.',
    icon: (
      <>
        <path d="M12 3 2 9l10 6 10-6-10-6z" />
        <path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" />
      </>
    ),
  },
  {
    id: 'elementary',
    title: 'Grade School',
    levels: 'Grades 1 to 6',
    description:
      'Comprehensive basic education that builds strong foundations in Mathematics, Science, English, and Chinese language and culture.',
    icon: (
      <>
        <path d="M12 6.5C10.5 5 8.5 4.5 4 4.5v13c4.5 0 6.5.5 8 2 1.5-1.5 3.5-2 8-2v-13c-4.5 0-6.5.5-8 2z" />
        <path d="M12 6.5v13" />
      </>
    ),
  },
  {
    id: 'jhs',
    title: 'Junior High School',
    levels: 'Grades 7 to 10',
    description:
      'Developing critical thinking and leadership through specialized subjects and extracurricular programs that prepare students for higher levels.',
    icon: (
      <>
        <path d="M9 3h6M10 3v6.5L5 19a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 19l-5-9.5V3" />
        <path d="M7.5 15h9" />
      </>
    ),
  },
  {
    id: 'shs',
    title: 'Senior High School',
    levels: 'Grades 11 to 12',
    description:
      'Specialized tracks designed for college preparation and career readiness, offering both Academic and Technical-Vocational strands.',
    icon: (
      <>
        <path d="M12 3 2 9l10 6 10-6-10-6z" />
        <path d="M20 9v6" />
        <path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" />
      </>
    ),
  },
];

const highlights = [
  { title: 'Bilingual Mastery', desc: 'Fluent proficiency in English, Filipino, and Chinese Mandarin.' },
  { title: 'VISTA AI Integration', desc: 'Digital-first learning assisted by our proprietary AI support system.' },
  { title: 'Cultural Immersion', desc: 'Deep appreciation for Chinese heritage and Filipino traditions.' },
  { title: 'Character Building', desc: "Integrating 'Knowledge and Virtue' in every subject area." },
  { title: 'Modern Facilities', desc: 'Safe, technologically-equipped classrooms and learning spaces.' },
  { title: 'Holistic Development', desc: 'Strong emphasis on Sports, Arts, and Leadership programs.' },
];

const Programs = () => {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col bg-white font-sans text-slate-800 selection:bg-yellow-300 selection:text-[#002855] dark:bg-[#00152e] dark:text-slate-100">
      <Navbar />

      <main className="flex-grow">
        <PageHeader
          eyebrow="Excellence in education"
          title="Academic programs"
          lede="Excellence across every stage of learning. We provide a holistic, rigorous, and culturally rich curriculum from preschool to senior high."
        />

        {/* LEVELS */}
        <section className="bg-white dark:bg-[#00152e]">
          <div className={SECTION}>
            <Label className="mb-3 block text-slate-500 dark:text-slate-400">Levels offered</Label>
            <h2 className={`${HEADING} mb-10`}>Four levels, one continuous curriculum</h2>

            <div className="grid gap-6 md:grid-cols-2">
              {academicLevels.map((level) => (
                <article
                  key={level.id}
                  className="flex flex-col gap-4 rounded-2xl border border-slate-200 p-7 dark:border-white/10 dark:bg-white/5"
                >
                  <IconTile>
                    <Icon>{level.icon}</Icon>
                  </IconTile>
                  <div>
                    <h3 className="text-xl font-semibold text-[#001f3f] dark:text-white">
                      {level.title}
                    </h3>
                    <Label className="mt-2 block text-slate-500 dark:text-slate-400">
                      {level.levels}
                    </Label>
                  </div>
                  <p className="leading-relaxed text-slate-600 dark:text-slate-300">
                    {level.description}
                  </p>
                  <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-5 dark:border-white/10">
                    <Label className="text-slate-500 dark:text-slate-400">
                      Accredited curriculum
                    </Label>
                    <button
                      onClick={() => navigate('/admissions')}
                      className="font-semibold text-blue-700 hover:underline dark:text-yellow-400"
                    >
                      Inquire now &rarr;
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* CURRICULUM HIGHLIGHTS */}
        <section className="border-y border-slate-200 bg-[#F0F4F8] dark:border-white/10 dark:bg-[#001f44]">
          <div className={SECTION}>
            <Label className="mb-3 block text-slate-500 dark:text-slate-400">The Yorklin edge</Label>
            <h2 className={`${HEADING} mb-3`}>Curriculum highlights</h2>
            <p className="mb-10 max-w-2xl text-lg leading-relaxed text-slate-600 dark:text-slate-300">
              Our programs are designed to provide a balanced education that honors heritage while
              embracing the future.
            </p>

            <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {highlights.map((h) => (
                <div key={h.title}>
                  <div className="mb-4 h-[3px] w-8 rounded-full bg-yellow-400" />
                  <h3 className="mb-2 text-lg font-semibold text-[#001f3f] dark:text-white">
                    {h.title}
                  </h3>
                  <p className="leading-relaxed text-slate-600 dark:text-slate-300">{h.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA — shared with Home, which carried a drifting copy of it. */}
        <EnrollCta primaryLabel="See admission requirements" showTour={false} />
      </main>

      <Footer />
    </div>
  );
};

export default Programs;
