// recommendations.js -- script for recommendations

const API_BASE_URL = "http://localhost:8000/api";

/**
 * Fetch recommendations for a customer
 * @param {number} customerId - Customer ID
 * @param {string} targetDate - Target date in YYYY-MM format
 * @param {number} k - Number of recommendations
 * @returns {Promise<Object>} Recommendation data
 */
export async function getCustomerRecommendations(
    customerId,
    targetDate = null,
    k = 3,
) {
    try {
        let url = `${API_BASE_URL}/recommendations/${customerId}/`;
        const params = new URLSearchParams();

        if (targetDate) {
            params.append("date", targetDate);
        }
        params.append("k", k);

        if (params.toString()) {
            url += `?${params.toString()}`;
        }

        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
            },
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(
                errorData.detail || "Failed to fetch recommendations",
            );
        }

        return await response.json();
    } catch (error) {
        console.error("Error fetching recommendations:", error);
        throw error;
    }
}

/**
 * Format price for display
 * @param {number} price
 * @returns {string}
 */
export function formatPrice(price) {
    return `₱${price.toFixed(2)}`;
}
