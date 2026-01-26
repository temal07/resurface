// Handles everything related to the page the user is on.

export const pageData = {
    id: "",
    name: "",
    url: "",
    favIcon: "",
    description: "",
}


export const updatePageData = (newData) => {
    Object.assign(pageData, newData);
}

export const renderPageData = (pageData, container) => {
    // Trim the page name if it's too long (e.g., > 50 chars)
    const trimmedName = pageData.name.length > 20 
        ? pageData.name.slice(0, 17) + "..." 
        : pageData.name;

    const trimmedLink = pageData.url.length > 30
        ? pageData.url.slice(0, 28) + "..."
        : pageData.url;

    container.innerHTML = `
        <ul class="">
            <li class="flex items-center gap-2 py-2 px-2 rounded-md" id=${pageData.id}>
                <img src=${pageData.favIcon} alt="Website 1 Icon" class="w-6 h-6 mr-2 rounded" />
                <span 
                    class="text-gray-700 font-medium flex-none"
                    title="${pageData.name}"
                >
                    ${trimmedName}
                </span>
                <span class="text-gray-400 flex items-center ml-2">
                    <a href=${pageData.url} class="hover:text-blue-700 text-blue-400 truncate max-w-max inline-block align-middle" id="url-1" target="_blank" rel="noopener noreferrer">
                        ${trimmedLink}
                    </a>
                </span>
            </li>
        </ul>
    `;
}
