import { hashPassword } from "better-auth/crypto";
import { prisma } from "../src/lib/prisma.js";
import { airlinesSeedContent } from "../src/features/cms/airlinesSeedContent.js";

async function main(total: number) {
  await prisma.$transaction(
    async (tx) => {
      // Define seed user email
      const seedUserEmail = "admin@flyarzan.com";

      // Delete existing seed user's sessions, accounts, and user record
      const existingUser = await tx.user.findUnique({
        where: { email: seedUserEmail },
        select: { id: true },
      });

      if (existingUser) {
        console.log("🗑️ Deleting existing seed user data...");
        // Delete sessions first (foreign key constraint)
        await tx.session.deleteMany({
          where: { userId: existingUser.id },
        });
        // Delete accounts (foreign key constraint)
        await tx.account.deleteMany({
          where: { userId: existingUser.id },
        });
        // Delete user
        await tx.user.delete({
          where: { id: existingUser.id },
        });
        console.log("✅ Existing seed user deleted");
      }

      // Create super admin
      const password = await hashPassword("12345678");

      const newUser = await tx.user.create({
        data: {
          name: "Zabet",
          email: seedUserEmail,
          emailVerified: true,
          role: "super",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Create account for user
      await tx.account.create({
        data: {
          userId: newUser.id,
          accountId: newUser.id,
          providerId: "credential",
          password,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      console.log("✅ Seed user created: admin@flyarzan.com / 12345678");

      // ============================================
      // CMS SEED DATA - Matching static page content
      // ============================================

      // ABOUT US PAGE
      const aboutUsContent = {
        hero: {
          heading: "About Us",
          subheading:
            "The perfect vacation comes true with our travel search engine.",
        },
        whoWeAre: {
          title: "Who We Are",
          paragraphs: [
            "At Fly Arzan, we make it easy to find the best deals on flights, hotels, and car rentals — all in one place.",
            "We're not a booking site — we're your travel search buddy. Just tell us where you want to go, and we'll help you compare prices from different airlines, hotels, and rental companies so you can pick what works best for you (and your wallet).",
            "The name 'Arzan' means affordable, and that's our goal: helping you travel smarter and cheaper without the stress.",
            "We only collect your email address (if you want updates on offers and deals), and we'll never spam you or share your info.",
            "Thanks for flying smart with Fly Arzan. Let's plan something amazing together.",
          ],
        },
        services: [
          {
            title: "Ticket Booking",
            description:
              "Access to domestic and international flights with competitive fares. Easy search and comparison to find the best deals for your schedule.",
          },
          {
            title: "Hotel Booking",
            description:
              "Curated lists of hotels, from budget-friendly to luxury stays. Filters to help you choose based on location, amenities, and price.",
          },
          {
            title: "Car Rental Services",
            description:
              "Reliable vehicles for self-drive or chauffeur-driven options. Flexible rental plans for business, leisure, or group travel.",
          },
        ],
        features: [
          {
            title: "Global Network",
            description:
              "We collaborate with leading travel providers to give you access to a wide range of services.",
          },
          {
            title: "User-Friendly Platform",
            description:
              "Our website and app are designed to provide a seamless booking experience.",
          },
          {
            title: "Dedicated Support",
            description: "Our travel experts are available 24/7 to assist you.",
          },
        ],
        whyChooseUs: {
          title: "Perfect Vacation Comes True",
          subtitle:
            "Founded with a mission to bridge the gap between travelers and their dream destinations. Over the years, we've grown into a trusted platform, partnering with top airlines, hotels, and car rental services to offer the best options to our customers.",
          items: [
            {
              title: "Airline Tickets",
              description:
                "We collaborate with leading travel providers to give you access to a wide range of services.",
            },
            {
              title: "Ocean Cruises",
              description:
                "Currently not offering any services. Our team is here to assist you via email with any travel inquiries.",
            },
            {
              title: "Transportation",
              description:
                "Reliable ground transportation options for your travel needs.",
            },
            {
              title: "Travel Itineraries",
              description:
                "Customized travel plans to make your journey seamless.",
            },
            {
              title: "Travel Insurance",
              description:
                "Protection for your trips with comprehensive coverage options.",
            },
            {
              title: "Local Guide",
              description:
                "Expert local guides to enhance your travel experience.",
            },
          ],
        },
      };

      // FAQ PAGE
      const faqContent = {
        hero: {
          title:
            "Having Questions About Us? We Have Just The Right Answers For You.",
          subtitle:
            "Welcome to our FAQ section, where we've answered the most common questions to help you plan and book your journey with confidence. Whether you're searching for flights, hotels, or car rentals, you'll find clear and helpful answers about how our travel search engine works.",
        },
        categories: [
          {
            name: "Website Working",
            items: [
              {
                question: "How do I search for flights on your website?",
                answer:
                  "Simply enter your departure city, destination, travel dates, and number of passengers. Our system will instantly search multiple airlines and travel providers to show you the best available options.",
              },
              {
                question: "Can I book a flight directly on your website?",
                answer:
                  "No, we are a travel search engine. Once you find a flight that suits your needs, we'll redirect you to the airline or travel agency's website to complete your booking.",
              },
              {
                question: "Are the flight prices shown in real-time?",
                answer:
                  "Yes, our platform pulls real-time data from providers to ensure you see the latest prices and availability. However, final confirmation happens on the provider's site.",
              },
              {
                question: "Do your flight prices include taxes and fees?",
                answer:
                  "Most prices include basic taxes and fees, but optional extras like baggage, meals, or seat selection may cost more and are shown on the booking provider's site.",
              },
              {
                question:
                  "Can I search for one-way, round-trip, or multi-city flights?",
                answer:
                  "Absolutely. You can choose your preferred trip type before starting your search and even add multiple destinations for a customized itinerary.",
              },
              {
                question: "Do you offer flexible date search options?",
                answer:
                  "Yes, our flexible date feature allows you to see the cheapest flights within a range of days around your chosen departure and return dates.",
              },
              {
                question:
                  "How can I filter flights by airline, price, or duration?",
                answer:
                  "After searching, use our filters to narrow down results by airline, price range, number of stops, travel time, and more.",
              },
              {
                question:
                  "Can I sort flights by shortest travel time or lowest price?",
                answer:
                  "Yes, you can easily sort results to find the fastest route, cheapest fare, or most convenient departure times.",
              },
              {
                question: "Do you show both budget and full-service airlines?",
                answer:
                  "Yes, we include results from major carriers, budget airlines, and online travel agencies to give you a complete picture of your options.",
              },
              {
                question: "Can I book international and domestic flights?",
                answer:
                  "Yes, we support searches for both domestic and international routes across a wide range of destinations and airlines.",
              },
              {
                question: "Can I set flight price alerts?",
                answer:
                  "We offer a price alert feature where you can subscribe to receive notifications when fares for a selected route drop.",
              },
              {
                question:
                  "Why does the price sometimes change when I click to book?",
                answer:
                  "Airline prices fluctuate constantly based on demand and availability. If the fare changes, it's usually updated in real time by the provider.",
              },
              {
                question:
                  "How do I know if baggage is included in the flight price?",
                answer:
                  "Each listing indicates whether checked or cabin baggage is included, and full details are available on the booking partner's site.",
              },
              {
                question:
                  "What should I do if I have issues with my flight booking?",
                answer:
                  "Since the booking is completed on the airline or agent's site, you'll need to contact them directly for help with changes, cancellations, or refunds.",
              },
              {
                question: "Can I book flights for groups or large families?",
                answer:
                  "Yes, you can search for flights for up to 9 passengers. For larger groups, we recommend contacting the airline or travel provider directly.",
              },
            ],
          },
          {
            name: "Hotel Reservations",
            items: [
              {
                question: "How do I search for hotels on your website?",
                answer:
                  "Enter your destination, travel dates, and the number of guests to instantly browse available hotels from multiple providers in one place.",
              },
              {
                question: "Can I book a hotel directly on your platform?",
                answer:
                  "No, we are a comparison site. Once you select a hotel, we'll redirect you to the booking provider's site to finalize your reservation.",
              },
              {
                question: "Are the hotel prices shown per person or per room?",
                answer:
                  "Prices are typically displayed per room, but details like number of guests and included services are available on the provider's page.",
              },
              {
                question: "Do your listings include taxes and fees?",
                answer:
                  "Some providers include taxes and fees in the total price, while others display them at checkout. We recommend reviewing this on the final booking page.",
              },
              {
                question: "How can I find hotels with free cancellation?",
                answer:
                  'Use the "Free Cancellation" filter in your search results to view properties that offer flexible cancellation policies.',
              },
              {
                question:
                  "Can I filter hotels by amenities like Wi-Fi, breakfast, or pool?",
                answer:
                  "Yes, you can refine your search with filters such as free Wi-Fi, breakfast included, swimming pool, pet-friendly, and more.",
              },
              {
                question: "Do you show both budget and luxury hotels?",
                answer:
                  "Yes, we list accommodations across all price ranges—from hostels and guesthouses to boutique hotels and luxury resorts.",
              },
              {
                question: "Can I view hotel photos and reviews before booking?",
                answer:
                  "Absolutely. You can view detailed photos, star ratings, and verified guest reviews for each hotel before making a decision.",
              },
              {
                question: "How do I know if a hotel is available for my dates?",
                answer:
                  "Availability is updated in real-time based on your selected travel dates. Only rooms that are open for booking will be shown.",
              },
              {
                question:
                  "Can I search for accommodations like apartments or villas?",
                answer:
                  "Yes, we include alternative accommodations such as serviced apartments, vacation homes, and villas in your search results.",
              },
              {
                question: "Do hotel listings show exact locations on a map?",
                answer:
                  "Yes, you can view hotel locations on a map to check proximity to landmarks, transport hubs, or neighborhoods.",
              },
              {
                question: "How do I book multiple rooms for a group?",
                answer:
                  "You can select the number of rooms needed during your search and view pricing based on group size.",
              },
              {
                question:
                  "What should I do if I want to make changes to my hotel booking?",
                answer:
                  "Please contact the hotel or booking provider directly to make any changes, as all bookings are handled through their platforms.",
              },
              {
                question:
                  "Can I earn rewards or loyalty points with hotel bookings?",
                answer:
                  "That depends on the booking provider. Some platforms allow you to earn loyalty points or apply discounts if you're a member.",
              },
              {
                question: "Is breakfast included in the hotel price?",
                answer:
                  "Some listings include breakfast, while others do not. You'll see this information clearly displayed before being redirected to the provider's site.",
              },
            ],
          },
          {
            name: "Car Rentals",
            items: [
              {
                question: "How do I search for car rentals?",
                answer:
                  "Enter your pickup location, dates, and times to instantly compare rental offers from various companies in one place.",
              },
              {
                question: "Can I book a rental car directly on your platform?",
                answer:
                  "No, we redirect you to the rental agency or booking partner's website where you can complete your reservation.",
              },
              {
                question: "Do I need a credit card to rent a car?",
                answer:
                  "Most rental companies require a credit card for the security deposit and booking. Check the rental conditions on the provider's site for specifics.",
              },
              {
                question: "Can I rent a car without a driver's license?",
                answer:
                  "No, a valid driver's license is required for all rentals. Some companies also require you to have held it for at least one year.",
              },
              {
                question:
                  "Are insurance and taxes included in the car rental price?",
                answer:
                  "Some providers include basic insurance and taxes, while others offer them as add-ons. Full details are available on the checkout page.",
              },
              {
                question: "What types of cars can I rent?",
                answer:
                  "You can choose from a wide range including economy, compact, SUVs, luxury, and vans based on your travel needs.",
              },
              {
                question:
                  "Can I pick up the car in one city and return it in another?",
                answer:
                  "Yes, this is called a one-way rental. Use the appropriate option during your search. Extra fees may apply depending on the route.",
              },
              {
                question: "Are there any age restrictions for renting a car?",
                answer:
                  "Most companies require drivers to be at least 21, and surcharges may apply for those under 25. Check the provider's terms for exact rules.",
              },
              {
                question:
                  "Do you offer filters like automatic vs manual transmission?",
                answer:
                  "Yes, you can filter search results by transmission type, fuel policy, passenger capacity, and more.",
              },
              {
                question: "Can I add a second driver to my rental?",
                answer:
                  "Many providers allow additional drivers for an extra fee. Be sure to include this option when completing your booking on the partner site.",
              },
              {
                question: "Is fuel included in the car rental price?",
                answer:
                  "Usually not. Most rentals follow a full-to-full fuel policy, meaning you return the car with the same fuel level it had at pickup.",
              },
              {
                question: "Can I cancel or modify my car rental booking?",
                answer:
                  "That depends on the provider's policy. Most offer free cancellation within a specific window. Details are provided on their site.",
              },
              {
                question: "What documents do I need when picking up the car?",
                answer:
                  "You typically need a driver's license, a credit card, and sometimes a booking confirmation or ID. Always check in advance with the rental company.",
              },
              {
                question: "Can I rent a car at the airport?",
                answer:
                  "Yes, our platform shows options for airport pickups, including on-site and shuttle-based rentals for added convenience.",
              },
              {
                question:
                  "What happens if my flight is delayed, and I miss the pickup time?",
                answer:
                  "Most rental companies allow a grace period. However, it's best to inform them directly if you anticipate delays, especially for after-hours pickups.",
              },
            ],
          },
          {
            name: "Payments",
            items: [
              {
                question: "Do I make any payments on your website?",
                answer:
                  "No, we do not process any transactions. Once you select a flight, hotel, or car rental, you'll be redirected to the provider's website to complete your booking and payment.",
              },
              {
                question:
                  "What payment methods can I use with travel providers?",
                answer:
                  "Most providers accept major credit and debit cards (Visa, Mastercard, American Express), and many also support PayPal, Apple Pay, or regional payment options.",
              },
              {
                question:
                  "Is it safe to enter my payment details on the booking site?",
                answer:
                  "Yes. We only partner with trusted travel providers who use secure, encrypted payment gateways to protect your personal and financial information.",
              },
              {
                question:
                  "Are there any hidden charges or booking fees from your side?",
                answer:
                  "No, our platform is completely free to use. You are never charged any extra fees by us — your payment goes directly to the travel provider.",
              },
              {
                question: "Will I be charged in my local currency?",
                answer:
                  "That depends on the provider. Many offer currency conversion and allow you to view and pay in your local currency at checkout.",
              },
              {
                question:
                  "Can I split the payment across multiple cards or people?",
                answer:
                  "Most providers require full payment from a single cardholder. For group bookings or shared costs, you may need to arrange payment separately.",
              },
              {
                question: "Do I need to pay the full amount upfront?",
                answer:
                  "It depends on the provider and the type of service. Some offer 'pay later' or deposit options, while others require full payment at the time of booking.",
              },
              {
                question:
                  "What happens if my payment fails on the provider's site?",
                answer:
                  "If a payment fails, you'll typically receive a prompt to try again or use a different method. You can also contact the provider's support team for assistance.",
              },
              {
                question: "Can I get a refund if I cancel my booking?",
                answer:
                  "Refund policies vary by provider and service type. Some offer full refunds within a time window, while others may charge a cancellation fee. Always check the terms before booking.",
              },
              {
                question: "Will I receive a payment confirmation or invoice?",
                answer:
                  "Yes. Once your payment is completed on the provider's site, you will receive a confirmation email and invoice directly from them.",
              },
            ],
          },
        ],
      };

      // PRIVACY POLICY PAGE
      const privacyPolicyContent = {
        lastUpdated: "January 2025",
        introduction:
          "Welcome to Fly Arzan! We are a search engine for flights, hotels, and car rentals. Your privacy is important to us, and we are committed to protecting your personal information. This Privacy Policy explains how we collect, use, and safeguard your data when you use our website.",
        sections: [
          {
            heading: "Information Collection",
            content:
              "Fly Arzan collects minimal user information to enhance your experience. The only personal data we collect is your Email Address — only if you voluntarily provide it to receive notifications about offers, promotions, and updates.",
            bulletPoints: [
              "Payment information (we redirect you to third-party booking platforms).",
              "Passport or ID details.",
              "Home addresses or phone numbers.",
            ],
          },
          {
            heading: "Use of Information",
            content:
              "Your email address (if provided) will be used solely for:",
            bulletPoints: [
              "Sending promotional offers and discounts.",
              "Notifying you about new features or updates on Fly Arzan.",
              "Responding to customer inquiries (if you contact us).",
            ],
          },
          {
            heading: "Data Security",
            content:
              "We implement industry-standard security measures to protect your information, including:",
            bulletPoints: [
              "Encryption (SSL) for data transmission.",
              "Secure storage of email addresses in protected databases.",
              "Regular security audits to prevent unauthorized access.",
            ],
          },
          {
            heading: "Third-Party Sharing",
            content:
              "Fly Arzan works with third-party service providers (e.g., airlines, hotels, car rental agencies) to deliver search results. When you click on a booking link, you will be redirected to their websites, which have their own privacy policies. We do not control or store:",
            bulletPoints: [
              "Booking transactions.",
              "Payment details.",
              "Personal data entered on third-party sites.",
            ],
          },
          {
            heading: "Cookies Policy",
            content:
              "Fly Arzan uses cookies and similar tracking technologies to:",
            bulletPoints: [
              "Improve website functionality.",
              "Personalize search results.",
              "Analyze user behavior (e.g., via Google Analytics) to enhance performance.",
            ],
          },
          {
            heading: "User Rights",
            content: "You have the right to:",
            bulletPoints: [
              "Access – Request details of the data we hold about you.",
              "Delete – Ask us to remove your email from our database.",
              "Unsubscribe – Opt out of marketing emails at any time via the Unsubscribe link in emails.",
            ],
          },
          {
            heading: "Changes to This Policy",
            content:
              "We may update this Privacy Policy occasionally. Any changes will be posted here, and we encourage you to review it periodically.",
            bulletPoints: [],
          },
          {
            heading: "Contact Us",
            content:
              "For questions, data requests, or concerns about privacy, please contact us at: Email: info@flyarzan.com | Website: www.flyarzan.com. Thank you for trusting Fly Arzan for your travel searches!",
            bulletPoints: [],
          },
        ],
      };

      // CONTACT PAGE
      const contactContent = {
        hero: {
          title: "Contact Us",
          subtitle: "We're always happy to connect!",
        },
        address: {
          line1: "Manchester",
          line2: "",
          city: "Manchester",
          country: "United Kingdom",
        },
        contactInfo: [
          { type: "email", label: "Our Email", value: "info@flyarzan.com" },
          {
            type: "address",
            label: "Working Hours",
            value: "Monday to Friday | 9:00 AM – 5:00 PM (GMT)",
          },
        ],
        socialLinks: [
          {
            type: "facebook",
            url: "https://www.facebook.com/profile.php?id=61571147600625",
          },
          { type: "twitter", url: "https://x.com/flyArzan" },
          { type: "instagram", url: "https://www.instagram.com/flyarzan/" },
          {
            type: "linkedin",
            url: "https://www.linkedin.com/in/fly-arzan-75228135b",
          },
        ],
        formSettings: {
          title: "We're always happy to connect!",
          subtitle:
            "If you're interested in advertising, promotions, partnerships, or just want to share feedback, please use the contact form below. Simply fill out your name, email, subject, and leave your message in the comments section — our team will review it and get back to you as soon as possible.",
        },
      };

      // VISA REQUIREMENTS PAGE
      const visaRequirementsContent = {
        hero: {
          title: "Visa Requirements",
          subtitle: "Essential visa information for your travel destinations",
        },
        introduction:
          "Before traveling internationally, it's important to understand the visa requirements for your destination country. Below you'll find information about visa requirements for popular destinations. Please note that visa requirements can change, so always verify with the official embassy or consulate before traveling.",
        countries: [
          {
            name: "United Arab Emirates",
            code: "AE",
            visaRequired: true,
            requirements:
              "Most nationalities can obtain a visa on arrival or apply for an e-visa. GCC nationals do not require a visa.",
            processingTime: "1-3 business days for e-visa",
            fees: "Varies by nationality and visa type",
            documents: [
              "Valid passport (minimum 6 months validity)",
              "Passport-sized photographs",
              "Proof of accommodation",
              "Return flight ticket",
              "Travel insurance (recommended)",
            ],
          },
          {
            name: "Turkey",
            code: "TR",
            visaRequired: true,
            requirements:
              "Many nationalities can apply for an e-visa online. Some countries have visa-free access for short stays.",
            processingTime: "Usually instant for e-visa",
            fees: "$50-60 USD for e-visa",
            documents: [
              "Valid passport (minimum 6 months validity)",
              "Completed e-visa application",
              "Credit/debit card for payment",
              "Return flight ticket",
            ],
          },
          {
            name: "Kazakhstan",
            code: "KZ",
            visaRequired: true,
            requirements:
              "Citizens of many countries can visit visa-free for up to 30 days. Others may need to apply for a visa in advance.",
            processingTime: "5-10 business days",
            fees: "Varies by visa type",
            documents: [
              "Valid passport",
              "Visa application form",
              "Passport photos",
              "Invitation letter (if required)",
              "Proof of accommodation",
            ],
          },
          {
            name: "Thailand",
            code: "TH",
            visaRequired: false,
            requirements:
              "Many nationalities can enter visa-free for 30-45 days. Visa on arrival available for some countries.",
            processingTime: "Instant for visa on arrival",
            fees: "2000 THB for visa on arrival",
            documents: [
              "Valid passport (minimum 6 months validity)",
              "Proof of onward travel",
              "Proof of accommodation",
              "Sufficient funds",
            ],
          },
          {
            name: "Malaysia",
            code: "MY",
            visaRequired: false,
            requirements:
              "Citizens of most countries can enter visa-free for 90 days. Some nationalities require a visa.",
            processingTime: "N/A for visa-free entry",
            fees: "Free for visa-free nationalities",
            documents: [
              "Valid passport (minimum 6 months validity)",
              "Return flight ticket",
              "Proof of sufficient funds",
            ],
          },
        ],
        generalInfo:
          "Visa requirements may change without notice. Always check with the official embassy or consulate of your destination country before traveling. Fly Arzan is not responsible for any visa-related issues. We recommend applying for visas well in advance of your travel dates.",
      };

      // Terms and Conditions content
      const termsConditionsContent = {
        lastUpdated: "December 15, 2024",
        introduction:
          "Welcome to Fly Arzan. By accessing and using our website and services, you agree to be bound by these Terms and Conditions. Please read them carefully before using our services.",
        sections: [
          {
            heading: "Acceptance of Terms",
            content:
              "By accessing or using Fly Arzan's services, you acknowledge that you have read, understood, and agree to be bound by these Terms and Conditions. If you do not agree with any part of these terms, you must not use our services.",
            bulletPoints: [],
          },
          {
            heading: "Service Description",
            content:
              "Fly Arzan is a flight comparison and booking platform that helps users find and compare flight prices from various airlines and travel partners. We act as an intermediary and do not operate flights ourselves.",
            bulletPoints: [
              "We provide flight search and comparison services",
              "Bookings are completed through our partner websites",
              "Prices and availability are subject to change",
            ],
          },
          {
            heading: "User Responsibilities",
            content:
              "As a user of our services, you are responsible for ensuring the accuracy of all information you provide and for complying with all applicable laws and regulations.",
            bulletPoints: [
              "Provide accurate personal and travel information",
              "Ensure valid travel documents (passport, visa, etc.)",
              "Review booking details before confirmation",
              "Comply with airline and destination country requirements",
            ],
          },
          {
            heading: "Booking and Payments",
            content:
              "All bookings made through Fly Arzan are subject to the terms and conditions of the respective airline or travel partner. Payment processing is handled by our partners.",
            bulletPoints: [
              "Prices are displayed in your selected currency",
              "Final prices are confirmed at the time of booking",
              "Payment is processed by our travel partners",
              "Cancellation and refund policies vary by airline",
            ],
          },
          {
            heading: "Limitation of Liability",
            content:
              "Fly Arzan shall not be liable for any direct, indirect, incidental, or consequential damages arising from the use of our services or any errors in flight information displayed on our platform.",
            bulletPoints: [],
          },
          {
            heading: "Changes to Terms",
            content:
              "We reserve the right to modify these Terms and Conditions at any time. Changes will be effective immediately upon posting on our website. Your continued use of our services constitutes acceptance of any changes.",
            bulletPoints: [],
          },
        ],
      };

      // Seed all CMS pages
      const cmsDefaults: Array<{ slug: string; title: string; content: any }> =
        [
          { slug: "about_us", title: "About Us", content: aboutUsContent },
          { slug: "faq", title: "FAQ", content: faqContent },
          {
            slug: "privacy_policy",
            title: "Privacy Policy",
            content: privacyPolicyContent,
          },
          {
            slug: "terms_and_conditions",
            title: "Terms & Conditions",
            content: termsConditionsContent,
          },
          { slug: "contact", title: "Contact", content: contactContent },
          {
            slug: "visa_requirements",
            title: "Visa Requirements",
            content: visaRequirementsContent,
          },
          {
            slug: "airlines",
            title: "Airline Information Hub",
            content: airlinesSeedContent,
          },
        ];

      for (const page of cmsDefaults) {
        await tx.cmsPage.upsert({
          where: { slug: page.slug },
          update: { title: page.title, content: page.content },
          create: { slug: page.slug, title: page.title, content: page.content },
        });
      }

      console.log("✅ CMS pages seeded successfully!");

      // ============================================
      // ROLES AND PERMISSIONS SEED DATA
      // ============================================

      // Define all permissions
      const permissionsData = [
        // User Management
        {
          resource: "user",
          action: "create",
          displayName: "Create User",
          group: "user_management",
        },
        {
          resource: "user",
          action: "list",
          displayName: "List Users",
          group: "user_management",
        },
        {
          resource: "user",
          action: "view",
          displayName: "View User Details",
          group: "user_management",
        },
        {
          resource: "user",
          action: "update",
          displayName: "Update User",
          group: "user_management",
        },
        {
          resource: "user",
          action: "delete",
          displayName: "Delete User",
          group: "user_management",
        },
        {
          resource: "user",
          action: "ban",
          displayName: "Ban User",
          group: "user_management",
        },
        {
          resource: "user",
          action: "unban",
          displayName: "Unban User",
          group: "user_management",
        },
        {
          resource: "user",
          action: "set-role",
          displayName: "Set User Role",
          group: "user_management",
        },
        {
          resource: "user",
          action: "set-password",
          displayName: "Set User Password",
          group: "user_management",
        },
        {
          resource: "user",
          action: "impersonate",
          displayName: "Impersonate User",
          group: "user_management",
        },
        {
          resource: "session",
          action: "list",
          displayName: "List Sessions",
          group: "user_management",
        },
        {
          resource: "session",
          action: "revoke",
          displayName: "Revoke Session",
          group: "user_management",
        },
        {
          resource: "session",
          action: "revoke-all",
          displayName: "Revoke All Sessions",
          group: "user_management",
        },

        // Role Management
        {
          resource: "role",
          action: "create",
          displayName: "Create Role",
          group: "role_management",
        },
        {
          resource: "role",
          action: "list",
          displayName: "List Roles",
          group: "role_management",
        },
        {
          resource: "role",
          action: "view",
          displayName: "View Role Details",
          group: "role_management",
        },
        {
          resource: "role",
          action: "update",
          displayName: "Update Role",
          group: "role_management",
        },
        {
          resource: "role",
          action: "delete",
          displayName: "Delete Role",
          group: "role_management",
        },
        {
          resource: "permission",
          action: "list",
          displayName: "List Permissions",
          group: "role_management",
        },
        {
          resource: "permission",
          action: "view",
          displayName: "View Permission Details",
          group: "role_management",
        },

        // CMS Management
        {
          resource: "cms",
          action: "create",
          displayName: "Create Content",
          group: "content_management",
        },
        {
          resource: "cms",
          action: "list",
          displayName: "List Content",
          group: "content_management",
        },
        {
          resource: "cms",
          action: "view",
          displayName: "View Content",
          group: "content_management",
        },
        {
          resource: "cms",
          action: "update",
          displayName: "Update Content",
          group: "content_management",
        },
        {
          resource: "cms",
          action: "delete",
          displayName: "Delete Content",
          group: "content_management",
        },
        {
          resource: "cms",
          action: "publish",
          displayName: "Publish Content",
          group: "content_management",
        },

        // Analytics
        {
          resource: "analytics",
          action: "view",
          displayName: "View Analytics",
          group: "analytics",
        },
        {
          resource: "analytics",
          action: "export",
          displayName: "Export Analytics",
          group: "analytics",
        },

        // System
        {
          resource: "system",
          action: "dashboard",
          displayName: "Access Dashboard",
          group: "system",
        },
        {
          resource: "system",
          action: "settings",
          displayName: "Manage Settings",
          group: "system",
        },
        {
          resource: "system",
          action: "logs",
          displayName: "View System Logs",
          group: "system",
        },

        // Feedback
        {
          resource: "feedback",
          action: "list",
          displayName: "List Feedback",
          group: "feedback",
        },
        {
          resource: "feedback",
          action: "view",
          displayName: "View Feedback",
          group: "feedback",
        },
        {
          resource: "feedback",
          action: "update",
          displayName: "Update Feedback",
          group: "feedback",
        },
        {
          resource: "feedback",
          action: "delete",
          displayName: "Delete Feedback",
          group: "feedback",
        },
      ];

      // Create permissions
      for (const perm of permissionsData) {
        await tx.permission.upsert({
          where: {
            resource_action: { resource: perm.resource, action: perm.action },
          },
          update: { displayName: perm.displayName, group: perm.group },
          create: perm,
        });
      }

      console.log("✅ Permissions seeded successfully!");

      // Get all permissions for role assignment
      const allPermissions = await tx.permission.findMany();
      const permissionMap = new Map(
        allPermissions.map((p) => [`${p.resource}:${p.action}`, p.id])
      );

      // Define roles with their permissions
      const rolesData = [
        {
          name: "super",
          description: "Full access to all features including system settings",
          isSystem: true,
          permissions: permissionsData.map((p) => `${p.resource}:${p.action}`), // All permissions
        },
        {
          name: "admin",
          description: "Full access to user and content management",
          isSystem: true,
          permissions: permissionsData
            .filter((p) => p.resource !== "system" || p.action !== "settings")
            .filter(
              (p) => p.action !== "impersonate" && p.action !== "set-password"
            )
            .map((p) => `${p.resource}:${p.action}`),
        },
        {
          name: "moderator",
          description: "Content moderation and user management",
          isSystem: true,
          permissions: [
            "user:list",
            "user:view",
            "user:ban",
            "user:unban",
            "session:list",
            "cms:list",
            "cms:view",
            "cms:update",
            "analytics:view",
            "system:dashboard",
            "feedback:list",
            "feedback:view",
            "feedback:update",
          ],
        },
        {
          name: "user",
          description: "Basic access to dashboard",
          isSystem: true,
          permissions: ["system:dashboard"],
        },
      ];

      // Create roles and assign permissions
      for (const roleData of rolesData) {
        const role = await tx.role.upsert({
          where: { name: roleData.name },
          update: { description: roleData.description },
          create: {
            name: roleData.name,
            description: roleData.description,
            isSystem: roleData.isSystem,
          },
        });

        // Delete existing role permissions
        await tx.rolePermission.deleteMany({
          where: { roleId: role.id },
        });

        // Create role permissions
        const rolePermissions = roleData.permissions
          .map((permKey) => {
            const permId = permissionMap.get(permKey);
            return permId ? { roleId: role.id, permissionId: permId } : null;
          })
          .filter(
            (rp): rp is { roleId: string; permissionId: string } => rp !== null
          );

        if (rolePermissions.length > 0) {
          await tx.rolePermission.createMany({
            data: rolePermissions,
            skipDuplicates: true,
          });
        }
      }

      console.log("✅ Roles seeded successfully!");
    },
    {
      maxWait: 60000, // 60 seconds max wait to acquire connection
      timeout: 120000, // 120 seconds timeout for the transaction
    }
  );
}

main(1)
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
