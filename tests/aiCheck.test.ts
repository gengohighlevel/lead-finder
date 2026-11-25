import { describe, it, expect } from 'vitest';
import { usableQuestion } from '../lib/aiCheck';

const booking = { service: 'Appointment Booking System', observation: "I couldn't find an online booking tool on Sunny Smiles Dental's website." };

describe('usableQuestion: only relevant, helpful model questions get through', () => {
  it('accepts a short on-topic question', () => {
    expect(usableQuestion('Do you currently offer online booking for new patients?', booking)).toBe(true);
    expect(usableQuestion('What steps do patients take to schedule an appointment?', booking)).toBe(true);
  });
  it('rejects a statement (the model repeated the fact instead of asking)', () => {
    expect(usableQuestion("I couldn't find an online booking tool on Sunny Smiles Dental's website.", booking)).toBe(false);
    expect(usableQuestion('You have no online booking.', booking)).toBe(false);
  });
  it('rejects a question about something else (llama asked about finding a dentist)', () => {
    expect(usableQuestion('Are you currently looking for a new dentist?', booking)).toBe(false);
    expect(usableQuestion('What types of dental services are you most interested in?', booking)).toBe(false);
  });
  it('rejects a question that just restates the fact', () => {
    expect(usableQuestion("Is there an online booking tool on Sunny Smiles Dental's website?", booking)).toBe(false);
  });
  it('rejects two questions in one, too long, too short', () => {
    expect(usableQuestion('Do you take bookings online? Or do people call?', booking)).toBe(false);
    expect(usableQuestion(`Do you take bookings online ${'and so on '.repeat(12)}?`, booking)).toBe(false);
    expect(usableQuestion('Booking?', booking)).toBe(false);
  });
  it('rejects tech words, hype, flattery and pressure', () => {
    expect(usableQuestion('Would you like to automate your booking with AI?', booking)).toBe(false);
    expect(usableQuestion('Would you like an amazing booking system?', booking)).toBe(false);
    expect(usableQuestion('Do you love how your booking works today?', booking)).toBe(false);
    expect(usableQuestion('Can I book a call with you today for a booking demo?', booking)).toBe(false);
  });
  it('checks the topic for each service', () => {
    expect(usableQuestion('After you send a quote, what usually happens next?', { service: 'Sales Pipeline System', observation: 'x' })).toBe(true);
    expect(usableQuestion('How do you ask happy customers for a review?', { service: 'Review & Reputation System', observation: 'x' })).toBe(true);
    expect(usableQuestion('How do you ask happy customers for a review?', { service: 'Payment Follow-Up System', observation: 'x' })).toBe(false);
    expect(usableQuestion('Who keeps track of new inquiries when you are busy?', { service: 'Lead Management System', observation: 'x' })).toBe(true);
  });
  it('lets an unknown service through on shape alone', () => {
    expect(usableQuestion('How do you handle that today?', { service: 'Something New', observation: 'x' })).toBe(true);
  });
});

describe('usableQuestion: phone calls count for booking', () => {
  it('accepts a question about missed calls', () => {
    expect(usableQuestion('How many calls do you miss in a day?', booking)).toBe(true);
  });
});

describe('usableQuestion: lead tracking counts for the pipeline service', () => {
  it('accepts a question about where leads come from', () => {
    expect(usableQuestion('Do you track where your leads are coming from on your website?', { service: 'Sales Pipeline System', observation: "I couldn't see any lead-source tracking on Lex Law's website." })).toBe(true);
    expect(usableQuestion('How do you know which marketing brings in new clients?', { service: 'Sales Pipeline System', observation: "I couldn't see any lead-source tracking on Lex Law's website." })).toBe(false); // no topic word
    expect(usableQuestion('Do you track which leads turn into clients?', { service: 'Sales Pipeline System', observation: 'x' })).toBe(true);
  });
});
