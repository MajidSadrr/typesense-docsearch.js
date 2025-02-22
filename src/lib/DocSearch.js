import Hogan from 'hogan.js';
import autocomplete from 'autocomplete.js';
import templates from './templates';
import utils from './utils';
import $ from './zepto';
import { SearchClient as TypesenseSearchClient } from 'typesense';
import { SearchResponseAdapter as TypesenseSearchResponseAdapter } from 'typesense-instantsearch-adapter/lib/SearchResponseAdapter';

/**
 * Adds an autocomplete dropdown to an input field
 * @function DocSearch
 * @param  {string} options.typesenseServerConfig        Typesense Server configuration, passed to typesense.js
 * @param  {string} options.typesenseCollectionName      Name of the collection to search
 * @param  {string} options.inputSelector  CSS selector that targets the input
 * @param  {Object} [options.typesenseSearchParams] Additional parameters to pass to the underlying Typesense client
 * @param  {Object} [options.autocompleteOptions] Options to pass to the underlying autocomplete instance
 * @return {Object}
 */
const usage = `Usage:
  docsearch({
  typesenseServerConfig,
  typesenseCollectionName,
  inputSelector,
  [ typesenseSearchParams.{per_page} ]
  [ autocompleteOptions.{hint,debug} ]
})`;

class DocSearch {
  constructor({
    typesenseServerConfig,
    typesenseCollectionName,
    inputSelector,
    debug = false,
    typesenseSearchParams = {},
    queryDataCallback = null,
    autocompleteOptions = {
      debug: false,
      hint: false,
      autoselect: true,
    },
    transformData = false,
    queryHook = false,
    handleSelected = false,
    enhancedSearchInput = false,
    layout = 'columns',
  }) {
    DocSearch.checkArguments({
      typesenseServerConfig,
      typesenseCollectionName,
      inputSelector,
      debug,
      typesenseSearchParams,
      queryDataCallback,
      autocompleteOptions,
      transformData,
      queryHook,
      handleSelected,
      enhancedSearchInput,
      layout,
    });

    this.typesenseServerConfig = typesenseServerConfig;
    this.typesenseCollectionName = typesenseCollectionName;
    this.input = DocSearch.getInputFromSelector(inputSelector);
    /* eslint-disable camelcase */
    this.typesenseSearchParams = {
      per_page: 5,
      query_by:
        'hierarchy.lvl0,hierarchy.lvl1,hierarchy.lvl2,hierarchy.lvl3,hierarchy.lvl4,hierarchy.lvl5,hierarchy.lvl6,content',
      group_by: 'url',
      group_limit: 1,
      include_fields:
        'hierarchy.lvl0,hierarchy.lvl1,hierarchy.lvl2,hierarchy.lvl3,hierarchy.lvl4,hierarchy.lvl5,hierarchy.lvl6,content,anchor,url',
      highlight_full_fields:
        'hierarchy.lvl0,hierarchy.lvl1,hierarchy.lvl2,hierarchy.lvl3,hierarchy.lvl4,hierarchy.lvl5,hierarchy.lvl6,content',
      ...typesenseSearchParams,
    };
    /* eslint-enable camelcase */
    this.queryDataCallback = queryDataCallback || null;
    const autocompleteOptionsDebug =
      autocompleteOptions && autocompleteOptions.debug
        ? autocompleteOptions.debug
        : false;
    // eslint-disable-next-line no-param-reassign
    autocompleteOptions.debug = debug || autocompleteOptionsDebug;
    this.autocompleteOptions = autocompleteOptions;
    this.autocompleteOptions.cssClasses =
      this.autocompleteOptions.cssClasses || {};
    this.autocompleteOptions.cssClasses.prefix =
      this.autocompleteOptions.cssClasses.prefix || 'ds';
    const inputAriaLabel =
      this.input &&
      typeof this.input.attr === 'function' &&
      this.input.attr('aria-label');
    this.autocompleteOptions.ariaLabel =
      this.autocompleteOptions.ariaLabel || inputAriaLabel || 'search input';

    this.isSimpleLayout = layout === 'simple';

    this.client = new TypesenseSearchClient(this.typesenseServerConfig);

    if (enhancedSearchInput) {
      this.input = DocSearch.injectSearchBox(this.input);
    }

    this.autocomplete = autocomplete(this.input, autocompleteOptions, [
      {
        source: this.getAutocompleteSource(transformData, queryHook),
        templates: {
          suggestion: DocSearch.getSuggestionTemplate(this.isSimpleLayout),
          footer: templates.footer,
          empty: DocSearch.getEmptyTemplate(),
        },
      },
    ]);

    const customHandleSelected = handleSelected;
    this.handleSelected = customHandleSelected || this.handleSelected;

    // We prevent default link clicking if a custom handleSelected is defined
    if (customHandleSelected) {
      $('.algolia-autocomplete').on('click', '.ds-suggestions a', event => {
        event.preventDefault();
      });
    }

    this.autocomplete.on(
      'autocomplete:selected',
      this.handleSelected.bind(null, this.autocomplete.autocomplete)
    );

    this.autocomplete.on(
      'autocomplete:shown',
      this.handleShown.bind(null, this.input)
    );

    if (enhancedSearchInput) {
      DocSearch.bindSearchBoxEvent();
    }
  }

  /**
   * Checks that the passed arguments are valid. Will throw errors otherwise
   * @function checkArguments
   * @param  {object} args Arguments as an option object
   * @returns {void}
   */
  static checkArguments(args) {
    if (!args.typesenseServerConfig || !args.typesenseCollectionName) {
      throw new Error(usage);
    }

    if (typeof args.inputSelector !== 'string') {
      throw new Error(
        `Error: inputSelector:${args.inputSelector}  must be a string. Each selector must match only one element and separated by ','`
      );
    }

    if (!DocSearch.getInputFromSelector(args.inputSelector)) {
      throw new Error(
        `Error: No input element in the page matches ${args.inputSelector}`
      );
    }
  }

  static injectSearchBox(input) {
    input.before(templates.searchBox);
    const newInput = input
      .prev()
      .prev()
      .find('input');
    input.remove();
    return newInput;
  }

  static bindSearchBoxEvent() {
    $('.searchbox [type="reset"]').on('click', function() {
      $('input#docsearch').focus();
      $(this).addClass('hide');
      autocomplete.autocomplete.setVal('');
    });

    $('input#docsearch').on('keyup', () => {
      const searchbox = document.querySelector('input#docsearch');
      const reset = document.querySelector('.searchbox [type="reset"]');
      reset.className = 'searchbox__reset';
      if (searchbox.value.length === 0) {
        reset.className += ' hide';
      }
    });
  }

  /**
   * Returns the matching input from a CSS selector, null if none matches
   * @function getInputFromSelector
   * @param  {string} selector CSS selector that matches the search
   * input of the page
   * @returns {void}
   */
  static getInputFromSelector(selector) {
    const input = $(selector).filter('input');
    return input.length ? $(input[0]) : null;
  }

  /**
   * Returns the `source` method to be passed to autocomplete.js. It will query
   * the Algolia index and call the callbacks with the formatted hits.
   * @function getAutocompleteSource
   * @param  {function} transformData An optional function to transform the hits
   * @param {function} queryHook An optional function to transform the query
   * @returns {function} Method to be passed as the `source` option of
   * autocomplete
   */
  getAutocompleteSource(transformData, queryHook) {
    return (query, callback) => {
      if (queryHook) {
        // eslint-disable-next-line no-param-reassign
        query = queryHook(query) || query;
      }

      this.client
        .collections(this.typesenseCollectionName)
        .documents()
        .search({
          q: query,
          ...this.typesenseSearchParams,
        })
        .then(data => {
          if (
            this.queryDataCallback &&
            typeof this.queryDataCallback === 'function'
          ) {
            this.queryDataCallback(data);
          }
          const typesenseSearchResponseAdapter = new TypesenseSearchResponseAdapter(
            data,
            {
              params: {
                highlightPreTag:
                  '<span class="typesense-docsearch-suggestion--highlight">',
                highlightPostTag: '</span>',
              },
            }
          );
          let hits = typesenseSearchResponseAdapter.adapt().hits;
          if (transformData) {
            hits = transformData(hits) || hits;
          }
          callback(DocSearch.formatHits(hits));
        });
    };
  }

  // Given a list of hits returned by the API, will reformat them to be used in
  // a Hogan template
  static formatHits(receivedHits) {
    const clonedHits = utils.deepClone(receivedHits);
    const hits = clonedHits.map(hit => {
      utils.assignNullValuesToMissingHierarchyFields(hit);
      utils.unnestFields(hit);
      if (hit._highlightResult) {
        utils.assignNullValuesToMissingHierarchyFields(hit._highlightResult);
        utils.unnestFields(hit._highlightResult);
        // eslint-disable-next-line no-param-reassign
        hit._highlightResult = utils.mergeKeyWithParent(
          hit._highlightResult,
          'hierarchy'
        );
      }
      return utils.mergeKeyWithParent(hit, 'hierarchy');
    });

    // Group hits by category / subcategory
    let groupedHits = utils.groupBy(hits, 'lvl0');
    $.each(groupedHits, (level, collection) => {
      const groupedHitsByLvl1 = utils.groupBy(collection, 'lvl1');
      const flattenedHits = utils.flattenAndFlagFirst(
        groupedHitsByLvl1,
        'isSubCategoryHeader'
      );
      groupedHits[level] = flattenedHits;
    });
    groupedHits = utils.flattenAndFlagFirst(groupedHits, 'isCategoryHeader');

    // Translate hits into smaller objects to be send to the template
    return groupedHits.map(hit => {
      const url = DocSearch.formatURL(hit);
      const category = utils.getHighlightedValue(hit, 'lvl0');
      const subcategory = utils.getHighlightedValue(hit, 'lvl1') || category;
      const displayTitle = utils
        .compact([
          utils.getHighlightedValue(hit, 'lvl2') || subcategory,
          utils.getHighlightedValue(hit, 'lvl3'),
          utils.getHighlightedValue(hit, 'lvl4'),
          utils.getHighlightedValue(hit, 'lvl5'),
          utils.getHighlightedValue(hit, 'lvl6'),
        ])
        .join(
          '<span class="aa-suggestion-title-separator" aria-hidden="true"> › </span>'
        );
      const text = utils.getSnippetedValue(hit, 'content');
      const isTextOrSubcategoryNonEmpty =
        (subcategory && subcategory !== '') ||
        (displayTitle && displayTitle !== '');
      const isLvl1EmptyOrDuplicate =
        !subcategory || subcategory === '' || subcategory === category;
      const isLvl2 =
        displayTitle && displayTitle !== '' && displayTitle !== subcategory;
      const isLvl1 =
        !isLvl2 &&
        subcategory &&
        subcategory !== '' &&
        subcategory !== category;
      const isLvl0 = !isLvl1 && !isLvl2;

      return {
        isLvl0,
        isLvl1,
        isLvl2,
        isLvl1EmptyOrDuplicate,
        isCategoryHeader: hit.isCategoryHeader,
        isSubCategoryHeader: hit.isSubCategoryHeader,
        isTextOrSubcategoryNonEmpty,
        category,
        subcategory,
        title: displayTitle,
        text,
        url,
      };
    });
  }

  static formatURL(hit) {
    const { url, anchor } = hit;
    if (url) {
      const containsAnchor = url.indexOf('#') !== -1;
      if (containsAnchor) return url;
      else if (anchor) return `${hit.url}#${hit.anchor}`;
      return url;
    } else if (anchor) return `#${hit.anchor}`;
    /* eslint-disable */
    console.warn("no anchor nor url for : ", JSON.stringify(hit));
    /* eslint-enable */
    return null;
  }

  static getEmptyTemplate() {
    return args => Hogan.compile(templates.empty).render(args);
  }

  static getSuggestionTemplate(isSimpleLayout) {
    const stringTemplate = isSimpleLayout
      ? templates.suggestionSimple
      : templates.suggestion;
    const template = Hogan.compile(stringTemplate);
    return suggestion => template.render(suggestion);
  }

  handleSelected(input, event, suggestion, datasetNumber, context = {}) {
    // Do nothing if click on the suggestion, as it's already a <a href>, the
    // browser will take care of it. This allow Ctrl-Clicking on results and not
    // having the main window being redirected as well
    if (context.selectionMethod === 'click') {
      return;
    }

    input.setVal('');
    window.location.assign(suggestion.url);
  }

  handleShown(input) {
    const middleOfInput = input.offset().left + input.width() / 2;
    let middleOfWindow = $(document).width() / 2;

    if (isNaN(middleOfWindow)) {
      middleOfWindow = 900;
    }

    const alignClass =
      middleOfInput - middleOfWindow >= 0
        ? 'algolia-autocomplete-right'
        : 'algolia-autocomplete-left';
    const otherAlignClass =
      middleOfInput - middleOfWindow < 0
        ? 'algolia-autocomplete-right'
        : 'algolia-autocomplete-left';
    const autocompleteWrapper = $('.algolia-autocomplete');
    if (!autocompleteWrapper.hasClass(alignClass)) {
      autocompleteWrapper.addClass(alignClass);
    }

    if (autocompleteWrapper.hasClass(otherAlignClass)) {
      autocompleteWrapper.removeClass(otherAlignClass);
    }
  }
}

export default DocSearch;
