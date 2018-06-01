import {assert} from 'chai';
import {spec} from 'modules/stroeerCoreBidAdapter';
const utils = require('src/utils');

describe('stroeerCore bid adapter', function () {
  let sandbox;
  let fakeServer;
  let bidderRequest;
  let clock;

  beforeEach(function() {
    bidderRequest = buildBidderRequest();
    sandbox = sinon.sandbox.create();
    fakeServer = sandbox.useFakeServer();
    clock = sandbox.useFakeTimers();
  });

  afterEach(function() {
    sandbox.restore();
  });

  function assertStandardFieldsOnBid(bidObject, bidId, ad, width, height, cpm) {
    assert.propertyVal(bidObject, 'requestId', bidId);
    assert.propertyVal(bidObject, 'ad', ad);
    assert.propertyVal(bidObject, 'width', width);
    assert.propertyVal(bidObject, 'height', height);
    assert.propertyVal(bidObject, 'cpm', cpm);
  }

  function assertCustomFieldsOnBid(bidObject, cpm2, floor, exchangeRate, nurl, originalAd, maxprice) {
    assert.propertyVal(bidObject, 'cpm2', cpm2);
    assert.propertyVal(bidObject, 'floor', floor);
    assert.propertyVal(bidObject, 'exchangeRate', exchangeRate);
    assert.propertyVal(bidObject, 'nurl', nurl);
    assert.propertyVal(bidObject, 'originalAd', originalAd);
    assert.isFunction(bidObject.generateAd);
    assert.propertyVal(bidObject, 'maxprice', maxprice);
  }

  const AUCTION_ID = utils.getUniqueIdentifierStr();

  const buildBidderRequest = () => ({
    auctionId: AUCTION_ID,
    bidderRequestId: 'bidder-request-id-123',
    bidderCode: 'stroeerCore',
    timeout: 5000,
    auctionStart: 10000,
    bids: [
      {
        bidId: 'bid1',
        bidder: 'stroeerCore',
        adUnitCode: 'div-1',
        sizes: [[300, 600], [160, 60]],
        mediaType: '',
        params: {
          sid: 'NDA='
        }
      },
      {
        bidId: 'bid2',
        bidder: 'stroeerCore',
        adUnitCode: 'div-2',
        sizes: [[728, 90]],
        params: {
          sid: 'ODA='
        }
      }
    ],
  });

  const buildBidderResponse = () => ({
    'bids': [{
      'bidId': 'bid1',
      'cpm': 4.0,
      'width': 300,
      'height': 600,
      'ad': '<div>tag1</div>'
    }, {
      'bidId': 'bid2',
      'cpm': 7.3,
      'width': 728,
      'height': 90,
      'ad': '<div>tag2</div>'
    }]
  });

  const buildBidderResponseSecondPriceAuction = () => {
    const response = buildBidderResponse();

    const bid1 = response.bids[0];
    bid1.cpm2 = 3.8;
    bid1.floor = 2.0;
    bid1.exchangeRate = 1.0;
    bid1.nurl = 'www.something.com';
    bid1.ssat = 2;
    bid1.maxprice = 2.38;

    const bid2 = response.bids[1];
    bid2.floor = 1.0;
    bid2.exchangeRate = 0.8;
    bid2.nurl = 'www.something-else.com';
    bid2.ssat = 2;

    return response;
  };

  const createWindow = (href, params = {}) => {
    let {parent, referrer, top, frameElement, placementElements = []} = params;
    const protocol = href.startsWith('https') ? 'https:' : 'http:';
    const win = {
      frameElement,
      parent,
      top,
      location: {
        protocol,
        href
      },
      document: {
        createElement: function () {
          return {
            setAttribute: function () {
            }
          }
        },
        referrer,
        getElementById: id => placementElements.find(el => el.id === id)
      }
    };

    win.self = win;

    if (!parent) {
      win.parent = win;
    }

    if (!top) {
      win.top = win;
    }

    return win;
  };

  function createElement(offsetTop = 0, id) {
    return {
      id,
      getBoundingClientRect: function () {
        return {
          top: offsetTop,
          height: 1
        }
      }
    }
  }

  function setupSingleWindow(sandbox, placementElements = [createElement(17, 'div-1'), createElement(54, 'div-2')]) {
    const win = createWindow('http://www.xyz.com/', {
      parent: win, top: win, frameElement: createElement(304), placementElements: placementElements
    });

    win.innerHeight = 200;

    sandbox.stub(utils, 'getWindowSelf').returns(win);
    sandbox.stub(utils, 'getWindowTop').returns(win);
    sandbox.stub(utils, 'getTopWindowReferrer').returns(win.document.referrer);

    return win;
  }

  function setupNestedWindows(sandbox, placementElements = [createElement(17, 'div-1'), createElement(54, 'div-2')]) {
    const topWin = createWindow('http://www.abc.org/', {referrer: 'http://www.google.com/?query=monkey'});
    topWin.innerHeight = 800;

    const midWin = createWindow('http://www.abc.org/', {parent: topWin, top: topWin, frameElement: createElement()});
    midWin.innerHeight = 400;

    const win = createWindow('http://www.xyz.com/', {
      parent: midWin, top: topWin, frameElement: createElement(304), placementElements
    });

    win.innerHeight = 200;

    sandbox.stub(utils, 'getWindowSelf').returns(win);
    sandbox.stub(utils, 'getWindowTop').returns(topWin);
    sandbox.stub(utils, 'getTopWindowReferrer').returns(topWin.document.referrer);

    return {topWin, midWin, win};
  }

  describe('bid validation entry point', () => {
    let validBidRequest = Object.freeze(buildBidderRequest().bids[0]);

    it('should have \"isBidRequestValid\" function', () => {
      assert.isFunction(spec.isBidRequestValid);
    });

    it('should pass a valid bid', () => {
      assert.isTrue(spec.isBidRequestValid(validBidRequest));
    });

    const invalidSsatSamples = [-1, 0, 3, 4];
    invalidSsatSamples.forEach((type) => {
      it(`server side auction type ${type} should be invalid`, function() {
        const bidRequest = Object.assign({}, validBidRequest);
        bidRequest.params.ssat = type;
        assert.isFalse(spec.isBidRequestValid(bidRequest));
      })
    });

    it('should exclude bids without slot id param', () => {
      const bidRequest = Object.assign({}, validBidRequest);
      delete bidRequest.params.sid;
      assert.isFalse(spec.isBidRequestValid(bidRequest));
    });
  });

  describe('build request entry point', () => {
    it('should have \"buildRequests\" function', () => {
      assert.isFunction(spec.buildRequests);
    });

    describe('url on server request info object', () => {
      let win;
      beforeEach(() => {
        win = setupSingleWindow(sandbox);
      });

      it('should use hardcoded url as default endpoint', () => {
        const bidderRequest = buildBidderRequest();
        let serverRequestInfo = spec.buildRequests(bidderRequest.bids, bidderRequest);

        assert.equal(serverRequestInfo.method, 'POST');
        assert.isObject(serverRequestInfo.data);
        assert.equal(serverRequestInfo.url, 'http://hb.adscale.de/dsh');
      });

      describe('should use custom url if provided', () => {
        const samples = [
          {
            protocol: 'http:',
            params: {sid: 'ODA=', host: 'other.com', port: '234', path: '/xyz'},
            expected: 'http://other.com:234/xyz'
          },
          {
            protocol: 'https:',
            params: {sid: 'ODA=', host: 'other.com', port: '234', path: '/xyz'},
            expected: 'https://other.com:234/xyz'
          },
          {
            protocol: 'https:',
            params: {sid: 'ODA=', host: 'other.com', port: '234', securePort: '871', path: '/xyz'},
            expected: 'https://other.com:871/xyz'
          },
          {
            protocol: 'http:',
            params: {sid: 'ODA=', port: '234', path: '/xyz'},
            expected: 'http://hb.adscale.de:234/xyz'
          },
        ];

        samples.forEach(sample => {
          it(`should use ${sample.expected} as endpoint when given params ${JSON.stringify(sample.params)} and protocol ${sample.protocol}`, function () {
            win.location.protocol = sample.protocol;

            const bidderRequest = buildBidderRequest();
            bidderRequest.bids[0].params = sample.params;
            bidderRequest.bids.length = 1;

            let serverRequestInfo = spec.buildRequests(bidderRequest.bids, bidderRequest);

            assert.equal(serverRequestInfo.method, 'POST');
            assert.isObject(serverRequestInfo.data);
            assert.equal(serverRequestInfo.url, sample.expected);
          });
        });
      });
    });

    describe('payload on server request info object', () => {
      let topWin;
      let placementElements;
      beforeEach(() => {
        placementElements = [createElement(17, 'div-1'), createElement(54, 'div-2')];
        ({topWin} = setupNestedWindows(sandbox, placementElements));
      });

      it('should have expected JSON structure', () => {
        clock.tick(13500);
        const bidderRequest = buildBidderRequest();

        const serverRequestInfo = spec.buildRequests(bidderRequest.bids, bidderRequest);

        const expectedTimeout = bidderRequest.timeout - (13500 - bidderRequest.auctionStart);

        assert.equal(expectedTimeout, 1500);

        const expectedJsonPayload = {
          'id': AUCTION_ID,
          'timeout': expectedTimeout,
          'ref': topWin.document.referrer,
          'mpa': true,
          'ssl': false,
          'ssat': 2,
          'bids': [
            {
              'sid': 'NDA=',
              'bid': 'bid1',
              'siz': [[300, 600], [160, 60]],
              'viz': true
            },
            {
              'sid': 'ODA=',
              'bid': 'bid2',
              'siz': [[728, 90]],
              'viz': true
            }
          ]
        };

        assert.deepEqual(serverRequestInfo.data, expectedJsonPayload);
      });

      describe('optional fields', () => {
        it('should use ssat value from config', function() {
          const bidderRequest = buildBidderRequest();
          bidderRequest.bids.length = 1;
          bidderRequest.bids[0].params.ssat = 99;
          const serverRequestInfo = spec.buildRequests(bidderRequest.bids, bidderRequest);
          assert.equal(99, serverRequestInfo.data.ssat);
        });

        it('should use 2 as default value for ssat', function() {
          const bidderRequest = buildBidderRequest();
          bidderRequest.bids.length = 1;
          delete bidderRequest.bids[0].params.ssat;
          const serverRequestInfo = spec.buildRequests(bidderRequest.bids, bidderRequest);
          assert.equal(2, serverRequestInfo.data.ssat);
        });

        it('should use first ssat value on a list of bids', function() {
          const bidderRequest = buildBidderRequest();

          delete bidderRequest.bids[0].params.ssat;

          bidderRequest.bids[1].params.ssat = 1;

          bidderRequest.bids.push({
            bidId: 'bid3',
            bidder: 'stroeerCore',
            placementCode: 'div-1',
            sizes: [[300, 600], [160, 60]],
            mediaType: '',
            params: {
              sid: 'NDA=',
              ssat: 2
            }
          });
          const serverRequestInfo = spec.buildRequests(bidderRequest.bids, bidderRequest);

          assert.equal(1, serverRequestInfo.data.ssat);
        });

        it('should skip viz field when unable to determine visibility of placement', () => {
          placementElements.length = 0;
          const bidderRequest = buildBidderRequest();

          const serverRequestInfo = spec.buildRequests(bidderRequest.bids, bidderRequest);
          assert.lengthOf(serverRequestInfo.data.bids, 2);

          for (let bid of serverRequestInfo.data.bids) {
            assert.isUndefined(bid.viz);
          }
        });

        it('should ref field when unable to determine document referrer', () => {
          // i.e., empty if user came from bookmark, or web page using 'rel="noreferrer" on link, etc
          utils.getTopWindowReferrer.restore();
          sandbox.stub(utils, 'getTopWindowReferrer').returns('');

          const bidderRequest = buildBidderRequest();

          const serverRequestInfo = spec.buildRequests(bidderRequest.bids, bidderRequest);
          assert.lengthOf(serverRequestInfo.data.bids, 2);

          for (let bid of serverRequestInfo.data.bids) {
            assert.isUndefined(bid.ref);
          }
        });
      });
    });
  });

  describe('interpret response entry point', () => {
    it('should have \"interpretResponse\" function', () => {
      assert.isFunction(spec.interpretResponse);
    });

    const invalidResponses = ['', '  ', ' ', undefined, null];
    invalidResponses.forEach(sample => {
      it('should ignore invalid responses (\"' + sample + '\") response', () => {
        const result = spec.interpretResponse({body: sample});
        assert.isArray(result);
        assert.lengthOf(result, 0);
      });
    });

    it('should ignore legacy (prebid < 1.0) redirect', function() {
      // Old workaround for CORS/Ajax/Redirect issues on a few browsers
      const legacyRedirect = {redirect: 'http://somewhere.com/over'};
      assert.throws(() => spec.interpretResponse({body: legacyRedirect}));
    });

    it('should intrepret a standard response', () => {
      const bidderResponse = buildBidderResponse();

      const result = spec.interpretResponse({body: bidderResponse});
      assertStandardFieldsOnBid(result[0], 'bid1', '<div>tag1</div>', 300, 600, 4);
      // default custom values
      assertCustomFieldsOnBid(result[0], 0, 4, undefined, undefined, '<div>tag1</div>', 4);

      assertStandardFieldsOnBid(result[1], 'bid2', '<div>tag2</div>', 728, 90, 7.3);
      // default custom values
      assertCustomFieldsOnBid(result[1], 0, 7.3, undefined, undefined, '<div>tag2</div>', 7.3);
    });

    it('should interpret a first price response', () => {
      const bidderResponse = buildBidderResponseSecondPriceAuction();

      const result = spec.interpretResponse({body: bidderResponse});
      assertStandardFieldsOnBid(result[0], 'bid1', '<div>tag1</div>', 300, 600, 4);
      assertCustomFieldsOnBid(result[0], 3.8, 2.0, 1.0, 'www.something.com', '<div>tag1</div>', 2.38);

      assertStandardFieldsOnBid(result[1], 'bid2', '<div>tag2</div>', 728, 90, 7.3);
      assertCustomFieldsOnBid(result[1], 0, 1.0, 0.8, 'www.something-else.com', '<div>tag2</div>', 7.3);
    });

    it('should default floor to same value as cpm and default cpm2 to 0', function() {
      const bidderResponse = buildBidderResponse();
      assert.isUndefined(bidderResponse.bids[0].floor);
      assert.isUndefined(bidderResponse.bids[0].cpm2);
      assert.isUndefined(bidderResponse.bids[1].floor);
      assert.isUndefined(bidderResponse.bids[1].cpm2);

      const result = spec.interpretResponse({body: bidderResponse});

      assert.propertyVal(result[0], 'cpm2', 0);
      assert.propertyVal(result[0], 'floor', 4.0);

      assert.propertyVal(result[1], 'cpm2', 0);
      assert.propertyVal(result[1], 'floor', 7.3);
    });

    describe('should add generateAd method on bid object', function() {
      const externalEncTests = [
        // full price text
        { price: '1.570000', bidId: '123456789123456789', exchangeRate: 1.0, expectation: 'MTIzNDU2Nzg5MTIzNDU2N8y5DxfESCHg5CTVFw' },
        // partial price text
        { price: '1.59', bidId: '123456789123456789123456789', exchangeRate: 1.0, expectation: 'MTIzNDU2Nzg5MTIzNDU2N8y5Dxn0eBHQELptyg' },
        // large bidId will be trimmed (> 16 characters)
        { price: '1.59', bidId: '123456789123456789', exchangeRate: 1.0, expectation: 'MTIzNDU2Nzg5MTIzNDU2N8y5Dxn0eBHQELptyg' },
        // small bidId will be padded (< 16 characters)
        { price: '1.59', bidId: '123456789', exchangeRate: 1.0, expectation: 'MTIzNDU2Nzg5MDAwMDAwMDJGF0WFzgb7CQC2Nw' },
        // float instead of text
        { price: 1.59, bidId: '123456789123456789', exchangeRate: 1.0, expectation: 'MTIzNDU2Nzg5MTIzNDU2N8y5Dxn0eBHQELptyg' },
        // long price after applying exchange rate: 12.03 * 0.32 = 3.8495999999999997 (use 3.8496)
        { price: 12.03, bidId: '123456789123456789', exchangeRate: 0.32, expectation: 'MTIzNDU2Nzg5MTIzNDU2N865AhTNThHQOG035A' },
        // long price after applying exchange rate: 22.23 * 0.26 = 5.779800000000001 (use 5.7798)
        { price: 22.23, bidId: '123456789123456789', exchangeRate: 0.26, expectation: 'MTIzNDU2Nzg5MTIzNDU2N8i5DRfNQBHQ4_a0lA' },
        // somehow empty string for price
        { price: '', bidId: '123456789123456789', exchangeRate: 1.0, expectation: 'MTIzNDU2Nzg5MTIzNDU2N_2XOiD0eBHQUWJCcw' },
        // handle zero
        { price: 0, bidId: '123456789123456789', exchangeRate: 1.0, expectation: 'MTIzNDU2Nzg5MTIzNDU2N82XOiD0eBHQdRlVNg' }
      ];
      externalEncTests.forEach(test => {
        it(`should replace \${AUCTION_PRICE:ENC} macro with ${test.expectation} given auction price ${test.price} and exchange rate ${test.exchangeRate}`, function() {
          const bidderResponse = buildBidderResponse();

          const responseBid = bidderResponse.bids[0];
          responseBid.exchangeRate = test.exchangeRate;
          responseBid.ad = '<img src=\'tracker.com?p=${AUCTION_PRICE:ENC}></img>';
          responseBid.bidId = test.bidId;

          const result = spec.interpretResponse({body: bidderResponse});

          const bid = result[0];
          // Prebid will do this
          bid.adId = test.bidId;

          const ad = bid.generateAd({auctionPrice: test.price});

          const rx = /<img src='tracker.com\?p=(.*)><\/img>/g;
          const encryptedPrice = rx.exec(ad);
          assert.equal(encryptedPrice[1], test.expectation);
        });
      });

      const internalEncTests = [
        // full price text
        {price: '1.570000', bidId: '123456789123456789', exchangeRate: 1.0, expectation: 'MTIzNDU2Nzg5MTIzNDU2Ny0i6OIZLp-4uQ97nA'},
        // ignore exchange rate
        {price: '1.570000', bidId: '123456789123456789', exchangeRate: 0.5, expectation: 'MTIzNDU2Nzg5MTIzNDU2Ny0i6OIZLp-4uQ97nA'},
        // partial price text
        {price: '2.945', bidId: '123456789123456789', exchangeRate: 1.0, expectation: 'MTIzNDU2Nzg5MTIzNDU2Ny4i5OEcHq-I-FhZIg'}
        // not all combos required. Already tested on other macro (white box testing approach)
      ];
      internalEncTests.forEach(test => {
        it(`should replace \${SSP_AUCTION_PRICE:ENC} macro with ${test.expectation} given auction price ${test.price} with exchange rate ${test.exchangeRate} ignored`, function() {
          const bidderResponse = buildBidderResponse();

          const responseBid = bidderResponse.bids[0];
          responseBid.exchangeRate = test.exchangeRate;
          responseBid.ad = '<img src=\'tracker.com?p=${SSP_AUCTION_PRICE:ENC}></img>';
          responseBid.bidId = test.bidId;

          const result = spec.interpretResponse({body: bidderResponse});

          const bid = result[0];
          // Prebid will do this
          bid.adId = test.bidId;

          const ad = bid.generateAd({auctionPrice: test.price});

          const rx = /<img src='tracker.com\?p=(.*)><\/img>/g;
          const encryptedPrice = rx.exec(ad);
          assert.equal(encryptedPrice[1], test.expectation);
        });
      });

      it('should replace all occurrences of ${SPP_AUCTION_PRICE:ENC}', function() {
        const bidderResponse = buildBidderResponse({bidId1: '123456789123456789'});

        const responseBid = bidderResponse.bids[0];
        responseBid.ad = '<img src=\'tracker.com?p=${SSP_AUCTION_PRICE:ENC}></img>\n<script>var price=${SSP_AUCTION_PRICE:ENC}</script>';
        responseBid.bidId = '123456789123456789';

        const result = spec.interpretResponse({body: bidderResponse});

        const bid = result[0];
        // Prebid will do this
        bid.adId = '123456789123456789';

        const ad = bid.generateAd({auctionPrice: '40.22'});

        const expectedAd = '<img src=\'tracker.com?p=MTIzNDU2Nzg5MTIzNDU2Nyg88-cbHq-IYqegZw></img>\n<script>var price=MTIzNDU2Nzg5MTIzNDU2Nyg88-cbHq-IYqegZw</script>';
        assert.equal(ad, expectedAd);
      });

      it('should replace all occurrences of ${AUCTION_PRICE:ENC}', function() {
        const bidderResponse = buildBidderResponse({bidId1: '123456789123456789'});

        const responseBid = bidderResponse.bids[0];
        responseBid.ad = '<img src=\'tracker.com?p=${AUCTION_PRICE:ENC}></img>\n<script>var price=${AUCTION_PRICE:ENC}</script>';
        responseBid.bidId = '123456789123456789';

        const result = spec.interpretResponse({body: bidderResponse});

        const bid = result[0];
        // Prebid will do this
        bid.adId = '123456789123456789';

        const ad = bid.generateAd({auctionPrice: '40.22'});

        const expectedAd = '<img src=\'tracker.com?p=MTIzNDU2Nzg5MTIzNDU2N8mnFBLGeBHQseHrBA></img>\n<script>var price=MTIzNDU2Nzg5MTIzNDU2N8mnFBLGeBHQseHrBA</script>';
        assert.equal(ad, expectedAd);
      });

      it('should replace all occurrences of ${AUCTION_PRICE}', function() {
        const bidderResponse = buildBidderResponse();

        const responseBid = bidderResponse.bids[0];
        responseBid.ad = '<img src=\'tracker.com?p=${AUCTION_PRICE}></img>\n<script>var price=${AUCTION_PRICE}</script>';
        responseBid.bidId = '123456789123456789';

        const result = spec.interpretResponse({body: bidderResponse});

        const bid = result[0];
        // Prebid will do this
        bid.adId = '123456789123456789';

        // Mimic prebid by replacing AUCTION_PRICE macros in ad. We keep the original for generateAd.
        bid.ad = bid.ad.replace(/\${AUCTION_PRICE}/g, '1.1111111');

        const ad = bid.generateAd({auctionPrice: 40.22});

        const expectedAd = '<img src=\'tracker.com?p=40.22></img>\n<script>var price=40.22</script>';
        assert.equal(ad, expectedAd);
      });

      it('should replace all macros at the same time', function() {
        const bidderResponse = buildBidderResponse();

        const responseBid = bidderResponse.bids[0];
        responseBid.ad = '<img src=\'tracker.com?p=${AUCTION_PRICE}&e=${AUCTION_PRICE:ENC}></img>\n<script>var price=${SSP_AUCTION_PRICE:ENC}</script>';
        responseBid.bidId = '123456789123456789';

        const result = spec.interpretResponse({body: bidderResponse});

        const bid = result[0];
        // Prebid will do this
        bid.adId = '123456789123456789';

        const ad = bid.generateAd({auctionPrice: 40.22});

        const expectedAd = '<img src=\'tracker.com?p=40.22&e=MTIzNDU2Nzg5MTIzNDU2N8mnFBLGeBHQseHrBA></img>\n<script>var price=MTIzNDU2Nzg5MTIzNDU2Nyg88-cbHq-IYqegZw</script>';
        assert.equal(ad, expectedAd);
      });

      it('should replace all occurrences of ${FIRST_BID:ENC}', function() {
        const bidderResponse = buildBidderResponse();

        const responseBid = bidderResponse.bids[0];
        responseBid.ad = '<img src=\'tracker.com?p=${FIRST_BID:ENC}></img>\n<script>var price=${FIRST_BID:ENC}</script>';
        responseBid.bidId = '123456789123456789';
        responseBid.maxprice = 3.0;

        const result = spec.interpretResponse({body: bidderResponse});
        const bid = result[0];
        // Prebid will do this
        bid.adId = '123456789123456789';

        const ad = bid.generateAd({auctionPrice: '40.22', firstBid: '21.00'});

        const expectedAd = '<img src=\'tracker.com?p=MTIzNDU2Nzg5MTIzNDU2Ny498-UZHq-IEVNNYA></img>\n<script>var price=MTIzNDU2Nzg5MTIzNDU2Ny498-UZHq-IEVNNYA</script>';
        assert.equal(ad, expectedAd);
      });

      it('should replace all occurrences of ${FIRST_BID:ENC} with empty string if no first bid', function() {
        const bidderResponse = buildBidderResponse();

        const responseBid = bidderResponse.bids[0];
        responseBid.ad = '<img src=\'tracker.com?p=${FIRST_BID:ENC}></img>\n<script>var price=${FIRST_BID:ENC}</script>';
        responseBid.bidId = '123456789123456789';
        responseBid.maxprice = 3.0;

        const result = spec.interpretResponse({body: bidderResponse});
        const bid = result[0];
        // Prebid will do this
        bid.adId = '123456789123456789';

        const ad = bid.generateAd({auctionPrice: '40.22'});

        const expectedAd = '<img src=\'tracker.com?p=></img>\n<script>var price=</script>';
        assert.equal(ad, expectedAd);
      });

      it('should replace all occurrences of ${SECOND_BID:ENC}', function() {
        const bidderResponse = buildBidderResponse();

        const responseBid = bidderResponse.bids[0];
        responseBid.ad = '<img src=\'tracker.com?p=${SECOND_BID:ENC}></img>\n<script>var price=${SECOND_BID:ENC}</script>';
        responseBid.bidId = '123456789123456789';
        responseBid.maxprice = 3.0;

        const result = spec.interpretResponse({body: bidderResponse});
        const bid = result[0];
        // Prebid will do this
        bid.adId = '123456789123456789';

        const ad = bid.generateAd({auctionPrice: '40.22', secondBid: '21.00'});

        const expectedAd = '<img src=\'tracker.com?p=MTIzNDU2Nzg5MTIzNDU2Ny498-UZHq-IEVNNYA></img>\n<script>var price=MTIzNDU2Nzg5MTIzNDU2Ny498-UZHq-IEVNNYA</script>';
        assert.equal(ad, expectedAd);
      });

      it('should replace all occurrences of ${THIRD_BID:ENC}', function() {
        const bidderResponse = buildBidderResponse({bidId1: '123456789123456789'});

        const responseBid = bidderResponse.bids[0];
        responseBid.ad = '<img src=\'tracker.com?p=${THIRD_BID:ENC}></img>\n<script>var price=${THIRD_BID:ENC}</script>';
        responseBid.bidId = '123456789123456789';
        responseBid.maxprice = 3.0;

        const result = spec.interpretResponse({body: bidderResponse});
        const bid = result[0];
        // Prebid will do this
        bid.adId = '123456789123456789';

        const ad = bid.generateAd({auctionPrice: '40.22', thirdBid: '21.00'});

        const expectedAd = '<img src=\'tracker.com?p=MTIzNDU2Nzg5MTIzNDU2Ny498-UZHq-IEVNNYA></img>\n<script>var price=MTIzNDU2Nzg5MTIzNDU2Ny498-UZHq-IEVNNYA</script>';
        assert.equal(ad, expectedAd);
      });

      it('should replace all occurrences of ${SECOND_BID:ENC} with empty string if no second bid', function() {
        const bidderResponse = buildBidderResponse({bidId1: '123456789123456789'});

        const responseBid = bidderResponse.bids[0];
        responseBid.ad = '<img src=\'tracker.com?p=${SECOND_BID:ENC}></img>\n<script>var price=${SECOND_BID:ENC}</script>';
        responseBid.bidId = '123456789123456789';
        responseBid.maxprice = 3.0;

        const result = spec.interpretResponse({body: bidderResponse});
        const bid = result[0];
        // Prebid will do this
        bid.adId = '123456789123456789';

        const ad = bid.generateAd({auctionPrice: '40.22'});

        const expectedAd = '<img src=\'tracker.com?p=></img>\n<script>var price=</script>';
        assert.equal(ad, expectedAd);
      });

      it('should replace all occurrences of ${THIRD_BID:ENC} with empty string if no second bid', function() {
        const bidderResponse = buildBidderResponse({bidId1: '123456789123456789'});

        const responseBid = bidderResponse.bids[0];
        responseBid.ad = '<img src=\'tracker.com?p=${THIRD_BID:ENC}></img>\n<script>var price=${THIRD_BID:ENC}</script>';
        responseBid.bidId = '123456789123456789';
        responseBid.maxprice = 3.0;

        const result = spec.interpretResponse({body: bidderResponse});
        const bid = result[0];
        // Prebid will do this
        bid.adId = '123456789123456789';

        const ad = bid.generateAd({auctionPrice: '40.22'});

        const expectedAd = '<img src=\'tracker.com?p=></img>\n<script>var price=</script>';
        assert.equal(ad, expectedAd);
      });

      describe('price truncation in generateAd', function () {
        const d = new Decrpyter('c2xzRWh5NXhpZmxndTRxYWZjY2NqZGNhTW1uZGZya3Y=');
        const validPrices = [
          {price: '1.5700000', expectation: '1.570000'},
          {price: '12345678', expectation: '12345678'},
          {price: '1234.56789', expectation: '1234.567'},
          {price: '12345.1234', expectation: '12345.12'},
          {price: '123456.10', expectation: '123456.1'},
          {price: '123456.105', expectation: '123456.1'},
          {price: '1234567.0052', expectation: '1234567'},
        ];
        validPrices.forEach(test => {
          it(`should safely truncate ${test.price} to ${test.expectation}`, function() {
            const bidderResponse = buildBidderResponse();

            const responseBid = bidderResponse.bids[0];
            responseBid.ad = '<img src=\'tracker.com?p=${AUCTION_PRICE:ENC}></img>';

            const result = spec.interpretResponse({body: bidderResponse});
            const bid = result[0];
            // Prebid will do this
            bid.adId = '123456789123456789';

            const ad = bid.generateAd({auctionPrice: test.price});

            const rx = /<img src='tracker.com\?p=(.*)><\/img>/g;
            const encryptedPrice = rx.exec(ad);
            assert.equal(d.decrypt(encryptedPrice[1]), test.expectation);
          });
        });

        const invalidPrices = [
          { price: '123456789' },
          { price: '123456.15' },
          { price: '1234567.0152' },
          { price: '1234567.1052' },
        ];
        invalidPrices.forEach(test => {
          it(`should error when price is ${test.price}`, function () {
            const bidderResponse = buildBidderResponse();

            const responseBid = bidderResponse.bids[0];
            responseBid.ad = '<img src=\'tracker.com?p=${AUCTION_PRICE:ENC}></img>';

            const result = spec.interpretResponse({body: bidderResponse});
            const bid = result[0];
            // Prebid will do this
            bid.adId = '123456789123456789';

            assert.throws(() => bid.generateAd({auctionPrice: test.price}), Error);
          });
        });
      });
    });
  });

  describe('get user syncs entry point', () => {
    let win;
    beforeEach(() => {
      win = setupSingleWindow(sandbox);

      // fake
      win.document.createElement = function() {
        const attrs = {};
        return {
          setAttribute: (name, value) => { attrs[name] = value },
          getAttribute: (name) => attrs[name],
          hasAttribute: (name) => attrs[name] !== undefined,
          tagName: 'SCRIPT',
        }
      }
    });

    function prepForUserConnect(customUserConnectJsUrl = '') {
      const bidderRequest = buildBidderRequest();
      assert.equal(bidderRequest.bids[0].params.sid, 'NDA=');

      if (customUserConnectJsUrl) {
        bidderRequest.bids[0].params.connectjsurl = customUserConnectJsUrl;
      }

      // To get a slot id
      spec.buildRequests(bidderRequest.bids, bidderRequest);

      sandbox.stub(utils, 'insertElement');
    }

    function assertConnectJs(actualElement, expectedUrl, expectedSlotId) {
      assert.strictEqual(actualElement.tagName, 'SCRIPT');
      assert.strictEqual(actualElement.src, expectedUrl);

      if (expectedSlotId) {
        const config = JSON.parse(actualElement.getAttribute('data-container-config'));
        assert.equal(config.slotId, expectedSlotId);
      } else {
        assert.isFalse(actualElement.hasAttribute('data-container-config'));
      }
    }

    it('should have \"getUserSyncs\" function', () => {
      assert.isFunction(spec.getUserSyncs);
    });

    it('should perform user connect when there was a response', () => {
      prepForUserConnect();

      spec.getUserSyncs({}, ['']);

      assert.isTrue(utils.insertElement.calledOnce);
      const element = utils.insertElement.lastCall.args[0];

      assertConnectJs(element, '//js.adscale.de/userconnect.js', 'NDA=');
    });

    it('should still perform user connect when no sid found', () => {
      sandbox.stub(utils, 'insertElement');

      win.top.stroeerCore = {};

      spec.getUserSyncs({}, ['']);

      assert.isTrue(utils.insertElement.calledOnce);
      const element = utils.insertElement.lastCall.args[0];

      assertConnectJs(element, '//js.adscale.de/userconnect.js');
    });

    it('should not perform user connect when there was no response', () => {
      prepForUserConnect();
      spec.getUserSyncs({}, []/* empty, zero-length array */);
      assert.isTrue(utils.insertElement.notCalled);
    });

    it('should perform user connect using custom url', () => {
      const customUserConnectJsUrl = 'https://other.com/connect.js';
      prepForUserConnect(customUserConnectJsUrl);

      spec.getUserSyncs({}, ['']);

      assert.isTrue(utils.insertElement.calledOnce);
      const element = utils.insertElement.lastCall.args[0];

      assertConnectJs(element, customUserConnectJsUrl, 'NDA=');
    });
  });
});

function Decrpyter(encKey) {
  this.encKey = atob(encKey);
}

function unwebSafeBase64EncodedString(str) {
  let pad = '';
  if (str.length % 4 === 2) pad += '==';
  else if (str.length % 4 === 1) pad += '=';

  str = str.replace(/-/g, '+')
    .replace(/_/g, '/');

  return str + pad;
}

Decrpyter.prototype.decrypt = function(str) {
  const unencodedStr = atob(unwebSafeBase64EncodedString(str));
  const CIPHERTEXT_SIZE = 8;

  const initVector = unencodedStr.substring(0, 16);
  const cipherText = unencodedStr.substring(16, 16 + CIPHERTEXT_SIZE);
  // const signature = unencodedStr.substring(16 + CIPHERTEXT_SIZE);

  const pad = str_hmac_sha1(this.encKey, initVector);

  let unencryptedPrice = '';

  for (let i = 0; i < CIPHERTEXT_SIZE; i++) {
    let priceCharCode = cipherText.charCodeAt(i);
    const charCode = 0xff & (priceCharCode ^ convertSignedByte(pad.charCodeAt(i)));
    if (charCode === 0) {
      break;
    }
    unencryptedPrice = unencryptedPrice + String.fromCharCode(charCode);
  }

  // ignore integrity

  return unencryptedPrice;
};

function convertSignedByte(value) {
  if (value >= 128) {
    return value - 256;
  } else {
    return value;
  }
}

// Code taken from http://pajhome.org.uk/crypt/md5/sha1.js
/*
 * Configurable variables. You may need to tweak these to be compatible with
 * the server-side, but the defaults work in most cases.
 */
const chrsz = 8; // bits per input character. 8 - ASCII; 16 - Unicode

/*
 * These are the functions you'll usually want to call
 * They take string arguments and return either hex or base-64 encoded strings
 */
function str_hmac_sha1(key, data) { return binb2str(core_hmac_sha1(key, data)); }

/*
 * Calculate the SHA-1 of an array of big-endian words, and a bit length
 */
function core_sha1(x, len) {
  /* append padding */
  x[len >> 5] |= 0x80 << (24 - len % 32);
  x[((len + 64 >> 9) << 4) + 15] = len;

  let w = Array(80);
  let a = 1732584193;
  let b = -271733879;
  let c = -1732584194;
  let d = 271733878;
  let e = -1009589776;

  for (let i = 0; i < x.length; i += 16) {
    const olda = a;
    const oldb = b;
    const oldc = c;
    const oldd = d;
    const olde = e;

    for (let j = 0; j < 80; j++) {
      if (j < 16) w[j] = x[i + j];
      else w[j] = rol(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
      const t = safe_add(safe_add(rol(a, 5), sha1_ft(j, b, c, d)),
        safe_add(safe_add(e, w[j]), sha1_kt(j)));
      e = d;
      d = c;
      c = rol(b, 30);
      b = a;
      a = t;
    }

    a = safe_add(a, olda);
    b = safe_add(b, oldb);
    c = safe_add(c, oldc);
    d = safe_add(d, oldd);
    e = safe_add(e, olde);
  }
  return [a, b, c, d, e]; // Was Array(a, b, c, d, e)
}

/*
 * Perform the appropriate triplet combination function for the current
 * iteration
 */
function sha1_ft(t, b, c, d) {
  if (t < 20) return (b & c) | ((~b) & d);
  if (t < 40) return b ^ c ^ d;
  if (t < 60) return (b & c) | (b & d) | (c & d);
  return b ^ c ^ d;
}

/*
 * Determine the appropriate additive constant for the current iteration
 */
function sha1_kt(t) {
  return (t < 20) ? 1518500249 : (t < 40) ? 1859775393
    : (t < 60) ? -1894007588 : -899497514;
}

/*
 * Calculate the HMAC-SHA1 of a key and some data
 */
function core_hmac_sha1(key, data) {
  let bkey = str2binb(key);
  if (bkey.length > 16) bkey = core_sha1(bkey, key.length * chrsz);

  const ipad = Array(16);
  const opad = Array(16);
  for (let i = 0; i < 16; i++) {
    ipad[i] = bkey[i] ^ 0x36363636;
    opad[i] = bkey[i] ^ 0x5C5C5C5C;
  }

  const hash = core_sha1(ipad.concat(str2binb(data)), 512 + data.length * chrsz);
  return core_sha1(opad.concat(hash), 512 + 160);
}

/*
 * Add integers, wrapping at 2^32. This uses 16-bit operations internally
 * to work around bugs in some JS interpreters.
 */
function safe_add(x, y) {
  const lsw = (x & 0xFFFF) + (y & 0xFFFF);
  const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
  return (msw << 16) | (lsw & 0xFFFF);
}

/*
 * Bitwise rotate a 32-bit number to the left.
 */
function rol(num, cnt) {
  return (num << cnt) | (num >>> (32 - cnt));
}

/*
 * Convert an 8-bit or 16-bit string to an array of big-endian words
 * In 8-bit function, characters >255 have their hi-byte silently ignored.
 */
function str2binb(str) {
  const bin = []; // was Array()
  const mask = (1 << chrsz) - 1;
  for (let i = 0; i < str.length * chrsz; i += chrsz) {
    bin[i >> 5] |= (str.charCodeAt(i / chrsz) & mask) << (32 - chrsz - i % 32);
  }
  return bin;
}

/*
 * Convert an array of big-endian words to a string
 */
function binb2str(bin) {
  let str = '';
  const mask = (1 << chrsz) - 1;
  for (let i = 0; i < bin.length * 32; i += chrsz) {
    str += String.fromCharCode((bin[i >> 5] >>> (32 - chrsz - i % 32)) & mask);
  }
  return str;
}
