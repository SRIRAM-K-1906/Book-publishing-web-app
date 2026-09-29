// script.js

// Future API link placeholder: 
// const dbApiUrl = "YOUR_API_ENDPOINT_HERE";

// Mock DB data for books
const mockBooks = [
    {
        id: 1,
        title: "The Silent Echo",
        author: "Eleanor Vance",
        category: "fiction",
        subcategory: "mystery",
        price: "$12.99",
        coverImage: "https://images.unsplash.com/photo-1614113489855-66422ad300a4?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: 2,
        title: "Neon Dreams",
        author: "Marcus Chen",
        category: "fiction",
        subcategory: "sci-fi",
        price: "$14.50",
        coverImage: "https://images.unsplash.com/photo-1534067783941-51c9c23ecefd?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: 3,
        title: "The Art of Stillness",
        author: "Sarah Jenkins",
        category: "non-fiction",
        subcategory: "self-help",
        price: "$9.99",
        coverImage: "https://images.unsplash.com/photo-1544947950-fa07a98d237f?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: 4,
        title: "Quantum Physics 101",
        author: "Dr. Robert Ford",
        category: "educational",
        subcategory: "science",
        price: "$29.99",
        coverImage: "https://images.unsplash.com/photo-1635070041078-e363dbe005cb?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: 5,
        title: "Whispers in the Wind",
        author: "Amelia Pond",
        category: "fiction",
        subcategory: "romance",
        price: "$11.00",
        coverImage: "https://images.unsplash.com/photo-1474932430478-367d16b99031?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: 6,
        title: "Digital Marketing Trends",
        author: "Alex Rivera",
        category: "non-fiction",
        subcategory: "business",
        price: "$19.99",
        coverImage: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: 7,
        title: "Learn JavaScript in 30 Days",
        author: "Code Masters",
        category: "educational",
        subcategory: "programming",
        price: "$24.99",
        coverImage: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?q=80&w=600&auto=format&fit=crop"
    },
    {
        id: 8,
        title: "Beyond the Horizon",
        author: "Chris Evans",
        category: "fiction",
        subcategory: "fantasy",
        price: "$15.99",
        coverImage: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=600&auto=format&fit=crop"
    }
];

// Subcategories mapping
const subcategoriesMap = {
    "fiction": ["mystery", "sci-fi", "romance", "fantasy"],
    "non-fiction": ["self-help", "business", "biography"],
    "educational": ["science", "programming", "history"]
};

// State
let currentCategory = "all";
let currentSubcategory = "all";
let currentSearch = "";

// DOM Elements
const bookGrid = document.getElementById('bookGrid');
const categoryContainer = document.getElementById('categoryContainer');
const subcategoryContainer = document.getElementById('subcategoryContainer');
const searchInput = document.getElementById('searchInput');

// Initialize
if (bookGrid) {
    document.addEventListener('DOMContentLoaded', () => {
        renderBooks();
        setupEventListeners();
        initScrollAnimations();
    });
}

function renderBooks() {
    if (!bookGrid) return;

    bookGrid.innerHTML = '';

    // Filter logic
    let filteredBooks = mockBooks.filter(book => {
        const matchesCategory = currentCategory === 'all' || book.category === currentCategory;
        const matchesSubcategory = currentSubcategory === 'all' || book.subcategory === currentSubcategory;

        const searchTerm = currentSearch.toLowerCase();
        const matchesSearch = book.title.toLowerCase().includes(searchTerm) ||
            book.author.toLowerCase().includes(searchTerm) ||
            book.category.toLowerCase().includes(searchTerm) ||
            book.subcategory.toLowerCase().includes(searchTerm);

        return matchesCategory && matchesSubcategory && matchesSearch;
    });

    if (filteredBooks.length === 0) {
        bookGrid.innerHTML = '<p style="text-align:center; grid-column: 1 / -1; color:#aaa; font-size: 1.2rem; padding: 2rem;">No books found matching your criteria.</p>';
        return;
    }

    filteredBooks.forEach((book, index) => {
        const card = document.createElement('div');
        card.className = 'book-card fade-in-up';
        // Set initial opacity to 0 for intersection observer
        card.style.opacity = '0';
        card.innerHTML = `
            <div class="book-cover">
                <img src="${book.coverImage}" alt="${book.title} cover">
                <h3 style="display:none;">${book.title}</h3>
            </div>
            <div class="book-info">
                <span class="book-category">${book.subcategory}</span>
                <h4 class="book-title">${book.title}</h4>
                <span class="book-author">by ${book.author}</span>
                <div class="book-footer">
                    <span class="book-price">${book.price}</span>
                    <button class="read-btn">Details</button>
                </div>
            </div>
        `;
        bookGrid.appendChild(card);
        // Delay animation slightly based on index
        card.style.animationDelay = `${index * 0.1}s`;
        if (typeof observer !== 'undefined') {
            observer.observe(card);
        }
    });
}

function renderSubcategories(category) {
    if (!subcategoryContainer) return;

    subcategoryContainer.innerHTML = '';
    currentSubcategory = 'all'; // Reset subcategory when category changes

    if (category === 'all' || !subcategoriesMap[category]) {
        subcategoryContainer.classList.remove('show');
        return;
    }

    const subs = subcategoriesMap[category];

    // Add "All" subcategory button
    const allBtn = document.createElement('button');
    allBtn.className = 'sub-btn active';
    allBtn.textContent = 'All ' + category;
    allBtn.dataset.sub = 'all';
    subcategoryContainer.appendChild(allBtn);

    subs.forEach(sub => {
        const btn = document.createElement('button');
        btn.className = 'sub-btn';
        btn.textContent = sub.charAt(0).toUpperCase() + sub.slice(1);
        btn.dataset.sub = sub;
        subcategoryContainer.appendChild(btn);
    });

    subcategoryContainer.classList.add('show');
}

function setupEventListeners() {
    // Category click
    if (categoryContainer) {
        categoryContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('category-btn')) {
                // Update active class
                document.querySelectorAll('.category-btn').forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active');

                currentCategory = e.target.dataset.category;
                renderSubcategories(currentCategory);
                renderBooks();
            }
        });
    }

    // Subcategory click
    if (subcategoryContainer) {
        subcategoryContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('sub-btn')) {
                // Update active class
                document.querySelectorAll('.sub-btn').forEach(btn => btn.classList.remove('active'));
                e.target.classList.add('active');

                currentSubcategory = e.target.dataset.sub;
                renderBooks();
            }
        });
    }

    // Search input
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            currentSearch = e.target.value;
            renderBooks();
        });

        // Navigate to library section on Enter key
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                currentSearch = searchInput.value;
                renderBooks();
                navigateToLibrary();
            }
        });
    }

    // Search button
    const searchBtn = document.getElementById('searchBtn');
    if (searchBtn && searchInput) {
        searchBtn.addEventListener('click', () => {
            currentSearch = searchInput.value;
            renderBooks();
            navigateToLibrary();
        });
    }
}

// Smoothly scroll to the library / books store section
function navigateToLibrary() {
    const librarySection = document.getElementById('library');
    if (librarySection) {
        librarySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}
// Intersection Observer for Scroll Animations
let observer;
function initScrollAnimations() {
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.15
    };

    observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                // Remove fade-in-up if it was already applied and re-apply to trigger
                entry.target.style.animation = 'none';
                entry.target.offsetHeight; /* trigger reflow */
                entry.target.style.animation = null;
                entry.target.classList.add('fade-in-up');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    // Observe static elements
    document.querySelectorAll('.section-header, .footer-col, .about-text, .stat-card').forEach((el, index) => {
        el.style.opacity = '0';
        // Add staggered delay for stat cards
        if (el.classList.contains('stat-card')) {
            el.style.animationDelay = `${(index % 6) * 0.1}s`;
        }
        observer.observe(el);
    });
}
