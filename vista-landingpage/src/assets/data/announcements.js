// Single source for school announcements.
//
// PLACEHOLDER CONTENT. These entries are samples with invented dates, kept so the
// Announcements page and the home page's news widget have something to render. The
// school posts real updates to its Facebook page — replace this array (or wire it to
// a feed) before launch.
export const FACEBOOK_PAGE = 'https://www.facebook.com/NRYS1939';

export const announcements = [
  {
    id: 1,
    date: 'April 20, 2026',
    category: 'Enrollment',
    title: 'Enrollment for SY 2026-2027 Officially Open',
    excerpt:
      'We are now accepting enrollees for the upcoming school year from Pre-Nursery to Senior High School. Early bird discounts apply until May 15.',
    isPinned: true,
  },
  {
    id: 2,
    date: 'April 10, 2026',
    category: 'Event',
    title: 'Annual Parent-Teacher Association (PTA) Meeting',
    excerpt:
      'Join us for the final PTA meeting of the academic year. We will discuss year-end activities, student clearances, and graduation preparations.',
    isPinned: false,
  },
  {
    id: 3,
    date: 'March 28, 2026',
    category: 'Academic',
    title: 'Release of 3rd Quarter Progress Reports',
    excerpt:
      "The 3rd quarter report cards are now available for viewing. Parents may claim the physical copies at the Registrar's Office during office hours.",
    isPinned: false,
  },
  {
    id: 4,
    date: 'March 15, 2026',
    category: 'Holiday',
    title: 'Suspension of Classes for Holy Week',
    excerpt:
      'Please be guided that there will be no classes in observance of the Holy Week. Regular operations will resume on the following Monday.',
    isPinned: false,
  },
];

export default announcements;
