const assert = require('chai').assert;
const adapter = require('modules/stroeerCoreBidAdapter');
const bidmanager = require('src/bidmanager');
const utils = require('src/utils');

function assertBid(bidObject, bidId, ad, width, height, cpm, floor = cpm) {
  assert.propertyVal(bidObject, 'adId', bidId);
  assert.propertyVal(bidObject, 'ad', ad);
  assert.propertyVal(bidObject, 'width', width);
  assert.propertyVal(bidObject, 'height', height);
  assert.propertyVal(bidObject, 'cpm', cpm);
  assert.propertyVal(bidObject, 'bidderCode', 'stroeerCore');
  assert.propertyVal(bidObject, 'floor', floor);
}

function assertNoFillBid(bidObject, bidId) {
  assert.propertyVal(bidObject, 'adId', bidId);
  assert.propertyVal(bidObject, 'bidderCode', 'stroeerCore');
  assert.notProperty(bidObject, 'ad');
  assert.notProperty(bidObject, 'cpm');
}

const buildBidderRequest = () => ({
  bidderRequestId: 'bidder-request-id-123',
  bidderCode: 'stroeerCore',
  timeout: 5000,
  auctionStart: 10000,
  bids: [
    {
      bidId: 'bid1',
      bidder: 'stroeerCore',
      placementCode: 'div-1',
      sizes: [[300, 600], [160, 60]],
      mediaType: '',
      params: {
        sid: 'NDA='
      }
    },
    {
      bidId: 'bid2',
      bidder: 'stroeerCore',
      placementCode: 'div-2',
      sizes: [[728, 90]],
      params: {
        sid: 'ODA='
      }
    }
  ],
});

const buildBidderRequestSecondPriceAuction = () => ({
  bidderRequestId: 'bidder-request-id-123',
  bidderCode: 'stroeerCore',
  timeout: 5000,
  auctionStart: 10000,
  bids: [
    {
      bidId: 'bid1',
      bidder: 'stroeerCore',
      placementCode: 'div-1',
      sizes: [[300, 600], [160, 60]],
      mediaType: '',
      params: {
        sid: 'NDA=',
        ssat: 2
      }
    },
    {
      bidId: 'bid2',
      bidder: 'stroeerCore',
      placementCode: 'div-2',
      sizes: [[728, 90]],
      params: {
        sid: 'ODA=',
        ssat: 2
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
  bid1.exchangerate = 1.0;
  bid1.nurl = 'www.something.com';
  bid1.ssat = 2;

  const bid2 = response.bids[1];
  bid2.floor = 1.0;
  bid2.exchangerate = 0.8;
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
      createElement: function() { return { setAttribute: function() {} } },

      referrer,
      getElementById: id => placementElements.find(el => el.id === id)
    }
  };

  if (!parent) {
    win.parent = win;
  }

  if (!top) {
    win.top = win;
  }

  return win;
};

describe('stroeerssp adapter', function () {
  let sandbox;
  let fakeServer;
  let bidderRequest;
  let clock;

  beforeEach(function() {
    bidderRequest = buildBidderRequest();
    sandbox = sinon.sandbox.create();
    sandbox.stub(bidmanager, 'addBidResponse');
    fakeServer = sandbox.useFakeServer();
    clock = sandbox.useFakeTimers();
  });

  afterEach(function() {
    sandbox.restore();
  });

  const topWin = createWindow('http://www.abc.org/', {referrer: 'http://www.google.com/?query=monkey'});
  topWin.innerHeight = 800;

  const midWin = createWindow('http://www.abc.org/', {parent: topWin, top: topWin, frameElement: createElement()});
  midWin.innerHeight = 400;

  const win = createWindow('http://www.xyz.com/', {
    parent: midWin, top: topWin, frameElement: createElement(304), placementElements: [createElement(17, 'div-1'), createElement(54, 'div-2')]
  });

  win.innerHeight = 200;

  function createElement(offsetTop = 0, id) {
    return {
      id,
      getBoundingClientRect: function() {
        return {
          top: offsetTop,
          height: 1
        }
      }
    }
  }

  it('should have `callBids` function', () => {
    assert.isFunction(adapter().callBids);
  });

  describe('bid request', () => {
    it('send bids as a POST request to default endpoint', function () {
      fakeServer.respondWith('');
      adapter(win).callBids(bidderRequest);
      fakeServer.respond();

      assert.equal(fakeServer.requests.length, 1);
      const request = fakeServer.requests[0];

      assert.equal(request.method, 'POST');
      assert.equal(request.url, 'http://dsh.adscale.de/dsh');
    });

    describe('send bids as a POST request to custom endpoint', function () {
      const tests = [
        {protocol: 'http:', params: {sid: 'ODA=', host: 'other.com', port: '234', path: '/xyz'}, expected: 'http://other.com:234/xyz'},
        {protocol: 'https:', params: {sid: 'ODA=', host: 'other.com', port: '234', path: '/xyz'}, expected: 'https://other.com:234/xyz'},
        {protocol: 'https:', params: {sid: 'ODA=', host: 'other.com', port: '234', securePort: '871', path: '/xyz'}, expected: 'https://other.com:871/xyz'},
        {protocol: 'http:', params: {sid: 'ODA=', port: '234', path: '/xyz'}, expected: 'http://dsh.adscale.de:234/xyz'},
      ];

      tests.forEach(test => {
        it(`using params ${JSON.stringify(test.params)} when protocol is ${test.protocol}`, function () {
          win.location.protocol = test.protocol;
          bidderRequest.bids[0].params = test.params;

          fakeServer.respondWith('');
          adapter(win).callBids(bidderRequest);
          fakeServer.respond();

          assert.equal(fakeServer.requests.length, 1);
          const request = fakeServer.requests[0];

          assert.equal(request.method, 'POST');
          assert.equal(request.url, test.expected);
        });
      });
    });

    it('sends bids in the expected JSON structure', function () {
      clock.tick(13500);

      fakeServer.respondWith(JSON.stringify(buildBidderResponse()));
      adapter(win).callBids(bidderRequest);
      fakeServer.respond();

      assert.equal(fakeServer.requests.length, 1);

      const request = fakeServer.requests[0];

      const bidRequest = JSON.parse(request.requestBody);

      const expectedTimeout = bidderRequest.timeout - (13500 - bidderRequest.auctionStart);

      assert.equal(expectedTimeout, 1500);

      const expectedJson = {
        'id': 'bidder-request-id-123',
        'timeout': expectedTimeout,
        'ref': 'http://www.google.com/?query=monkey',
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

      assert.deepEqual(bidRequest, expectedJson);
    });

    describe('Auction type (ssat) set (or not) in each individual bid', function() {
      it('test an auction with two valid and two non-valid auction types', function() {
        clock.tick(13500);

        const bidderRequestTwoValidOneInvalid = ({
          bidderRequestId: 'bidder-request-id-124',
          bidderCode: 'stroeerCore',
          timeout: 5000,
          auctionStart: 10000,
          bids: [
            {
              bidId: 'bid1',
              bidder: 'stroeerCore',
              placementCode: 'div-1',
              sizes: [[300, 600], [160, 60]],
              mediaType: '',
              params: {
                sid: 'NDA=',
                ssat: 2
              }
            },
            {
              bidId: 'bid2',
              bidder: 'stroeerCore',
              placementCode: 'div-2',
              sizes: [[728, 90]],
              params: {
                sid: 'ODA=',
                ssat: 0
              }
            },
            {
              bidId: 'bid3',
              bidder: 'stroeerCore',
              placementCode: 'div-3',
              sizes: [[300, 600], [160, 60]],
              mediaType: '',
              params: {
                sid: 'NDA=',
                ssat: 1
              }
            },
            {
              bidId: 'bid4',
              bidder: 'stroeerCore',
              placementCode: 'div-4',
              sizes: [[300, 600], [160, 60]],
              mediaType: '',
              params: {
                sid: 'NDA='
              }
            }
          ],
        });

        fakeServer.respondWith(JSON.stringify(buildBidderResponse()));
        adapter(win).callBids(bidderRequestTwoValidOneInvalid);
        fakeServer.respond();

        assert.equal(fakeServer.requests.length, 1);

        const request = fakeServer.requests[0];

        const bidRequest = JSON.parse(request.requestBody);

        const expectedTimeout = bidderRequest.timeout - (13500 - bidderRequest.auctionStart);

        assert.equal(expectedTimeout, 1500);

        const expectedJson = {
          'id': 'bidder-request-id-124',
          'timeout': expectedTimeout,
          'ref': 'http://www.google.com/?query=monkey',
          'mpa': true,
          'ssl': false,
          'ssat': 2,
          'bids': [
            {
              'sid': 'NDA=',
              'bid': 'bid1',
              'siz': [[300, 600], [160, 60]],
              'viz': true
            }
          ]
        };

        assert.deepEqual(bidRequest, expectedJson);
      });

      it('test an auction with explicitly set second auction type', function() {
        const expectedJsonRequestSecondAuction = {
          'id': 'bidder-request-id-125',
          'timeout': 1500,
          'ref': 'http://www.google.com/?query=monkey',
          'mpa': true,
          'ssl': false,
          'ssat': 2,
          'bids': [
            {
              'sid': 'NDA=',
              'bid': 'bid1',
              'siz': [[300, 600], [160, 60]],
              'viz': true,
            },
            {
              'sid': 'ODA=',
              'bid': 'bid2',
              'siz': [[728, 90]],
              'viz': true,
            }
          ]
        };

        clock.tick(13500);

        const bidderRequestSecondType = ({
          bidderRequestId: 'bidder-request-id-125',
          bidderCode: 'stroeerCore',
          timeout: 5000,
          auctionStart: 10000,
          bids: [
            {
              bidId: 'bid1',
              bidder: 'stroeerCore',
              placementCode: 'div-1',
              sizes: [[300, 600], [160, 60]],
              mediaType: '',
              params: {
                sid: 'NDA=',
                ssat: 2
              }
            },
            {
              bidId: 'bid2',
              bidder: 'stroeerCore',
              placementCode: 'div-2',
              sizes: [[728, 90]],
              params: {
                sid: 'ODA=',
                ssat: 2
              }
            }
          ],
        });

        fakeServer.respondWith(JSON.stringify(buildBidderResponseSecondPriceAuction()));
        adapter(win).callBids(bidderRequestSecondType);
        fakeServer.respond();

        assert.equal(fakeServer.requests.length, 1);

        const request = fakeServer.requests[0];

        const bidRequest = JSON.parse(request.requestBody);

        assert.deepEqual(bidRequest, expectedJsonRequestSecondAuction);
      });

      it('test an auction with ssat but no sid', function() {
        clock.tick(13500);

        const bidderRequestSecondType = ({
          bidderRequestId: 'bidder-request-id-125',
          bidderCode: 'stroeerCore',
          timeout: 5000,
          auctionStart: 10000,
          bids: [
            {
              bidId: 'bid1',
              bidder: 'stroeerCore',
              placementCode: 'div-1',
              sizes: [[300, 600], [160, 60]],
              mediaType: '',
              params: {
                ssat: 2
              }
            },
            {
              bidId: 'bid2',
              bidder: 'stroeerCore',
              placementCode: 'div-2',
              sizes: [[728, 90]],
              params: {
                ssat: 2
              }
            }
          ],
        });

        fakeServer.respondWith(JSON.stringify(buildBidderResponseSecondPriceAuction()));
        adapter(win).callBids(bidderRequestSecondType);
        fakeServer.respond();

        assert.equal(fakeServer.requests.length, 0);

        sinon.assert.calledTwice(bidmanager.addBidResponse);
      });

      /* This test no longer works as the SSAT is part of the bid params
      const invalidTypeSamples = [-1, 0, 3, 4];
      invalidTypeSamples.forEach((type) => {
        it(`invalid yieldlove auction type ${type} set on server`, function() {

          clock.tick(13500);

          fakeServer.respondWith(JSON.stringify(buildBidderResponse()));
          adapter(win).callBids(bidderRequest);
          fakeServer.respond();

          assert.equal(fakeServer.requests.length, 0);

          const request = fakeServer.requests[0];

          const expectedTimeout = bidderRequest.timeout - (13500 - bidderRequest.auctionStart);

          assert.equal(expectedTimeout, 1500);

          assertNoFillBid(bidmanager.addBidResponse.firstCall.args[1], 'bid1');
          assertNoFillBid(bidmanager.addBidResponse.secondCall.args[1], 'bid2');
        })
      }); */
    });

    describe('optional fields', () => {
      it('skip viz field when unable to determine visibility of placement', () => {
        const win = createWindow('http://www.xyz.com/', {
          referrer: 'http://www.google.com/?query=monkey',
          placementElements: []
        });

        fakeServer.respondWith('');
        adapter(win).callBids(bidderRequest);
        fakeServer.respond();

        const bids = JSON.parse(fakeServer.requests[0].requestBody).bids;
        assert.lengthOf(bids, 2);
        for (let bid of bids) {
          assert.notProperty(bid, 'viz');
        }
      });

      it('skip ref field when unable to determine document referrer', () => {
        const win = createWindow('http://www.xyz.com/', {
          referrer: '',
          placementElements: [createElement(17, 'div-1'), createElement(54, 'div-2')]
        });

        fakeServer.respondWith('');
        adapter(win).callBids(bidderRequest);
        fakeServer.respond();

        const payload = JSON.parse(fakeServer.requests[0].requestBody);
        assert.notProperty(payload, 'ref');
      });
    });
  });

  describe('bid response', () => {
    it('should redirect when told', function() {
      fakeServer.respondWith('POST', /\/dsh.adscale.de\//, JSON.stringify({redirect: 'http://somewhere.com/there'}));
      fakeServer.respondWith('POST', /\/somewhere.com\//, JSON.stringify(buildBidderResponse()));

      sandbox.stub(utils, 'insertElement');

      adapter().callBids(bidderRequest);

      fakeServer.respond();

      sinon.assert.notCalled(utils.insertElement);
      sinon.assert.notCalled(bidmanager.addBidResponse);

      fakeServer.respond();

      sinon.assert.calledOnce(utils.insertElement);
      const element = utils.insertElement.lastCall.args[0];

      assertConnectJs(element, 'http://js.adscale.de/userconnect.js', 'NDA=');

      sinon.assert.calledTwice(bidmanager.addBidResponse);

      assert.strictEqual(bidmanager.addBidResponse.firstCall.args[0], 'div-1');
      assert.strictEqual(bidmanager.addBidResponse.secondCall.args[0], 'div-2');

      const firstBid = bidmanager.addBidResponse.firstCall.args[1];
      const secondBid = bidmanager.addBidResponse.secondCall.args[1];

      assertBid(firstBid, 'bid1', '<div>tag1</div>', 300, 600, 4);
      assertBid(secondBid, 'bid2', '<div>tag2</div>', 728, 90, 7.3);
    });

    it('should never to more than one redirect', () => {
      fakeServer.respondWith('POST', /\/dsh.adscale.de\//, JSON.stringify({redirect: 'http://somewhere.com/over'}));
      fakeServer.respondWith('POST', /\/somewhere.com\//, JSON.stringify({redirect: 'http://somewhere.com/there'}));

      sandbox.stub(utils, 'insertElement');

      adapter().callBids(bidderRequest);

      fakeServer.respond();

      sinon.assert.notCalled(utils.insertElement);
      sinon.assert.notCalled(bidmanager.addBidResponse);

      fakeServer.respond();

      assert.strictEqual(fakeServer.requests.length, 2);

      sinon.assert.calledTwice(bidmanager.addBidResponse);

      assertNoFillBid(bidmanager.addBidResponse.firstCall.args[1], 'bid1');
      assertNoFillBid(bidmanager.addBidResponse.secondCall.args[1], 'bid2');
    });

    it('should add bids', function () {
      fakeServer.respondWith(JSON.stringify(buildBidderResponse()));

      adapter(win).callBids(bidderRequest);

      fakeServer.respond();

      sinon.assert.calledTwice(bidmanager.addBidResponse);

      assert.strictEqual(bidmanager.addBidResponse.firstCall.args[0], 'div-1');
      assert.strictEqual(bidmanager.addBidResponse.secondCall.args[0], 'div-2');

      const firstBid = bidmanager.addBidResponse.firstCall.args[1];
      const secondBid = bidmanager.addBidResponse.secondCall.args[1];

      assertBid(firstBid, 'bid1', '<div>tag1</div>', 300, 600, 4);
      assertBid(secondBid, 'bid2', '<div>tag2</div>', 728, 90, 7.3);
    });

    it('should get auction type from bid params', function() {
      fakeServer.respondWith(JSON.stringify(buildBidderResponseSecondPriceAuction()));

      adapter(win).callBids(bidderRequest);

      fakeServer.respond();

      sinon.assert.calledTwice(bidmanager.addBidResponse);

      let bid1 = bidmanager.addBidResponse.firstCall.args[1];
      assert.propertyVal(bid1, 'cpm2', 3.8);
      assert.propertyVal(bid1, 'floor', 2.0);
      assert.propertyVal(bid1, 'exchangerate', 1.0);
      assert.propertyVal(bid1, 'nurl', 'www.something.com');

      let bid2 = bidmanager.addBidResponse.secondCall.args[1];
      assert.propertyVal(bid2, 'cpm2', 0);
      assert.propertyVal(bid2, 'floor', 1.0);
      assert.propertyVal(bid2, 'exchangerate', 0.8);
      assert.propertyVal(bid2, 'nurl', 'www.something-else.com');
    });

    it('should default floor to same value as cpm and default cpm2 to 0', function() {
      const json = buildBidderResponse();
      assert.isUndefined(json.bids[0].floor);
      assert.isUndefined(json.bids[0].cpm2);
      assert.isUndefined(json.bids[1].floor);
      assert.isUndefined(json.bids[1].cpm2);


      fakeServer.respondWith(JSON.stringify(json));

      adapter(win).callBids(bidderRequest);

      fakeServer.respond();

      sinon.assert.calledTwice(bidmanager.addBidResponse);

      let bid1 = bidmanager.addBidResponse.firstCall.args[1];
      assert.propertyVal(bid1, 'cpm2', 0);
      assert.propertyVal(bid1, 'floor', 4.0);

      let bid2 = bidmanager.addBidResponse.firstCall.args[1];
      assert.propertyVal(bid2, 'cpm2', 0);
      assert.propertyVal(bid2, 'floor', 4.0);
    });

    it('should add unfulfilled bids', function() {
      const result = buildBidderResponse();

      result.bids[0].bidId = 'bidX';

      fakeServer.respondWith(JSON.stringify(result));

      adapter(win).callBids(bidderRequest);

      fakeServer.respond();

      assertNoFillBid(bidmanager.addBidResponse.secondCall.args[1], 'bid1');

      assertBid(bidmanager.addBidResponse.firstCall.args[1], 'bid2', '<div>tag2</div>', 728, 90, 7.3);
    });

    it('should exclude bids without slot id param', () => {
      fakeServer.respondWith(JSON.stringify(buildBidderResponse()));

      delete bidderRequest.bids[1].params.sid;

      adapter(win).callBids(bidderRequest);

      fakeServer.respond();

      sinon.assert.calledTwice(bidmanager.addBidResponse);

      assert.strictEqual(bidmanager.addBidResponse.firstCall.args[0], 'div-2');

      // invalid bids are added last
      assert.strictEqual(bidmanager.addBidResponse.secondCall.args[0], 'div-1');

      assertBid(bidmanager.addBidResponse.secondCall.args[1], 'bid1', '<div>tag1</div>', 300, 600, 4);

      assertNoFillBid(bidmanager.addBidResponse.firstCall.args[1], 'bid2');
    });

    it('should perform user connect when have valid bids', () => {
      runUserConnect();

      assert.isTrue(utils.insertElement.calledOnce);
      const element = utils.insertElement.lastCall.args[0];

      assert.strictEqual(element.tagName, 'SCRIPT');
      assert.strictEqual(element.src, 'http://js.adscale.de/userconnect.js');

      const config = JSON.parse(element.getAttribute('data-container-config'));
      assert.equal(config.slotId, 'NDA=');
    });

    it('should perform user connect when have invalid bids', () => {
      bidderRequest.bids.forEach(b => delete b.params.sid);
      runUserConnect();

      assert.isTrue(utils.insertElement.calledOnce);
      const element = utils.insertElement.lastCall.args[0];

      assertConnectJs(element, 'http://js.adscale.de/userconnect.js')
    });

    it('should perform user connect using custom url', () => {
      const customtUserConnectJsUrl = 'https://other.com/connect.js';
      bidderRequest.bids[0].params.connectjsurl = customtUserConnectJsUrl;

      runUserConnect();

      assert.isTrue(utils.insertElement.calledOnce);
      const element = utils.insertElement.lastCall.args[0];

      assertConnectJs(element, customtUserConnectJsUrl, 'NDA=')
    });

    describe('generateAd method on bid object', function() {
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
          responseBid.exchangerate = test.exchangeRate;
          responseBid.ad = '<img src=\'tracker.com?p=${AUCTION_PRICE:ENC}></img>';
          responseBid.bidId = test.bidId;

          fakeServer.respondWith(JSON.stringify(bidderResponse));

          bidderRequest.bids[0].bidId = test.bidId;

          adapter(win).callBids(bidderRequest);

          fakeServer.respond();

          const bid = bidmanager.addBidResponse.firstCall.args[1];
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
       {price: '2.945', bidId: '123456789123456789', exchangeRate: 1.0, expectation: 'MTIzNDU2Nzg5MTIzNDU2Ny4i5OEcHq-I-FhZIg'},
        // not all combos required. Already tested on other macro (white box testing approach)
      ];
      internalEncTests.forEach(test => {
        it(`should replace \${SSP_AUCTION_PRICE:ENC} macro with ${test.expectation} given auction price ${test.price} with exchange rate ${test.exchangeRate} ignored`, function() {
          const bidderResponse = buildBidderResponse();

          const responseBid = bidderResponse.bids[0];
          responseBid.exchangerate = test.exchangeRate;
          responseBid.ad = '<img src=\'tracker.com?p=${SSP_AUCTION_PRICE:ENC}></img>';
          responseBid.bidId = test.bidId;

          fakeServer.respondWith(JSON.stringify(bidderResponse));

          bidderRequest.bids[0].bidId = test.bidId;

          adapter(win).callBids(bidderRequest);

          fakeServer.respond();

          const bid = bidmanager.addBidResponse.firstCall.args[1];
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

        fakeServer.respondWith(JSON.stringify(bidderResponse));
        bidderRequest.bids[0].bidId = '123456789123456789';

        adapter(win).callBids(bidderRequest);

        fakeServer.respond();

        const bid = bidmanager.addBidResponse.firstCall.args[1];
        const ad = bid.generateAd({auctionPrice: '40.22'});

        const expectedAd = '<img src=\'tracker.com?p=MTIzNDU2Nzg5MTIzNDU2Nyg88-cbHq-IYqegZw></img>\n<script>var price=MTIzNDU2Nzg5MTIzNDU2Nyg88-cbHq-IYqegZw</script>';
        assert.equal(ad, expectedAd);
      });

      it('should replace all occurrences of ${AUCTION_PRICE:ENC}', function() {
        const bidderResponse = buildBidderResponse({bidId1: '123456789123456789'});

        const responseBid = bidderResponse.bids[0];
        responseBid.ad = '<img src=\'tracker.com?p=${AUCTION_PRICE:ENC}></img>\n<script>var price=${AUCTION_PRICE:ENC}</script>';
        responseBid.bidId = '123456789123456789';

        fakeServer.respondWith(JSON.stringify(bidderResponse));
        bidderRequest.bids[0].bidId = '123456789123456789';

        adapter(win).callBids(bidderRequest);

        fakeServer.respond();

        const bid = bidmanager.addBidResponse.firstCall.args[1];
        const ad = bid.generateAd({auctionPrice: '40.22'});

        const expectedAd = '<img src=\'tracker.com?p=MTIzNDU2Nzg5MTIzNDU2N8mnFBLGeBHQseHrBA></img>\n<script>var price=MTIzNDU2Nzg5MTIzNDU2N8mnFBLGeBHQseHrBA</script>';
        assert.equal(ad, expectedAd);
      });

      it('should replace all occurrences of ${AUCTION_PRICE}', function() {
        const bidderResponse = buildBidderResponse();

        const responseBid = bidderResponse.bids[0];
        responseBid.ad = '<img src=\'tracker.com?p=${AUCTION_PRICE}></img>\n<script>var price=${AUCTION_PRICE}</script>';
        responseBid.bidId = '123456789123456789';

        fakeServer.respondWith(JSON.stringify(bidderResponse));
        bidderRequest.bids[0].bidId = '123456789123456789';

        adapter(win).callBids(bidderRequest);

        fakeServer.respond();

        const bid = bidmanager.addBidResponse.firstCall.args[1];
        const ad = bid.generateAd({auctionPrice: 40.22});

        const expectedAd = '<img src=\'tracker.com?p=40.22></img>\n<script>var price=40.22</script>';
        assert.equal(ad, expectedAd);
      });

      it('should replace all macros at the same time', function() {
        const bidderResponse = buildBidderResponse();

        const responseBid = bidderResponse.bids[0];
        responseBid.ad = '<img src=\'tracker.com?p=${AUCTION_PRICE}&e=${AUCTION_PRICE:ENC}></img>\n<script>var price=${SSP_AUCTION_PRICE:ENC}</script>';
        responseBid.bidId = '123456789123456789';

        fakeServer.respondWith(JSON.stringify(bidderResponse));
        bidderRequest.bids[0].bidId = '123456789123456789';

        adapter(win).callBids(bidderRequest);

        fakeServer.respond();

        const bid = bidmanager.addBidResponse.firstCall.args[1];
        const ad = bid.generateAd({auctionPrice: 40.22});

        const expectedAd = '<img src=\'tracker.com?p=40.22&e=MTIzNDU2Nzg5MTIzNDU2N8mnFBLGeBHQseHrBA></img>\n<script>var price=MTIzNDU2Nzg5MTIzNDU2Nyg88-cbHq-IYqegZw</script>';
        assert.equal(ad, expectedAd);
      });
    });

    describe('price truncation', function() {
      const d = new Decrpyter('c2xzRWh5NXhpZmxndTRxYWZjY2NqZGNhTW1uZGZya3Y=');
      const validPrices = [
        { price: '1.5700000', expectation: '1.570000'},
        { price: '12345678', expectation: '12345678'},
        { price: '1234.56789', expectation: '1234.567'},
        { price: '12345.1234', expectation: '12345.12'},
        { price: '123456.10', expectation: '123456.1'},
        { price: '123456.105', expectation: '123456.1'},
        { price: '1234567.0052', expectation: '1234567'},
      ];
      validPrices.forEach(test => {
        it(`should safely truncate ${test.price} to ${test.expectation}`, function() {
          const bidderResponse = buildBidderResponse();

          const responseBid = bidderResponse.bids[0];
          responseBid.ad = '<img src=\'tracker.com?p=${AUCTION_PRICE:ENC}></img>';

          fakeServer.respondWith(JSON.stringify(bidderResponse));

          adapter(win).callBids(bidderRequest);

          fakeServer.respond();

          const bid = bidmanager.addBidResponse.firstCall.args[1];
          const ad = bid.generateAd({auctionPrice: test.price});

          const rx = /<img src='tracker.com\?p=(.*)><\/img>/g;
          const encryptedPrice = rx.exec(ad);
          assert.equal(d.decrypt(encryptedPrice[1]), test.expectation);
        });
      });

      const invalidPrices = [
        { price: '123456789'},
        { price: '123456.15'},
        { price: '1234567.0152'},
        { price: '1234567.1052'},
      ];
      invalidPrices.forEach(test => {
        it(`should error when price is ${test.price}`, function () {
          const bidderResponse = buildBidderResponse();

          const responseBid = bidderResponse.bids[0];
          responseBid.ad = '<img src=\'tracker.com?p=${AUCTION_PRICE:ENC}></img>';

          fakeServer.respondWith(JSON.stringify(bidderResponse));

          adapter(win).callBids(bidderRequest);

          fakeServer.respond();

          const bid = bidmanager.addBidResponse.firstCall.args[1];
          const fn = () => bid.generateAd({auctionPrice: test.price});

          assert.throws(fn, Error);
        });
      });
    });

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

    function runUserConnect() {
      fakeServer.respondWith(JSON.stringify(buildBidderResponse()));

      sandbox.stub(utils, 'insertElement');

      adapter().callBids(bidderRequest);

      fakeServer.respond();
    }
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
