import { expect } from 'chai';

import * as utils from 'src/utils';
import { config } from 'src/config';

import { spec } from 'modules/33acrossBidAdapter';

describe('33acrossBidAdapter:', function () {
  const BIDDER_CODE = '33across';
  const SITE_ID = 'pub1234';
  const PRODUCT_ID = 'product1';
  const END_POINT = 'https://ssc.33across.com/api/v1/hb';

  let element, win;
  let bidRequests;
  let sandbox;

  function TtxRequestBuilder() {
    const ttxRequest = {
      imp: [{
        banner: {
          format: [
            {
              w: 300,
              h: 250,
              ext: {}
            },
            {
              w: 728,
              h: 90,
              ext: {}
            }
          ],
          ext: {
            ttx: {
              viewability: {
                amount: 100
              }
            }
          }
        },
        ext: {
          ttx: {
            prod: PRODUCT_ID
          }
        }
      }],
      site: {
        id: SITE_ID
      },
      id: 'b1',
      user: {
        ext: {
          consent: undefined
        }
      },
      regs: {
        ext: {
          gdpr: 0
        }
      }
    };

    this.withSizes = sizes => {
      Object.assign(ttxRequest.imp[0].banner, { format: sizes });
      return this;
    };

    this.withViewabiliuty = viewability => {
      Object.assign(ttxRequest.imp[0].banner, {
        ext: {
          ttx: { viewability }
        }
      });
      return this;
    };

    this.withGdprConsent = (consent, gdpr) => {
      Object.assign(ttxRequest, {
        user: {
          ext: { consent }
        }
      });
      Object.assign(ttxRequest, {
        regs: {
          ext: { gdpr }
        }
      });
      return this;
    };

    this.withSite = site => {
      Object.assign(ttxRequest, { site });
      return this;
    };

    this.build = () => ttxRequest;
  }

  function ServerRequestBuilder() {
    const serverRequest = {
      'method': 'POST',
      'url': END_POINT,
      'data': null,
      'options': {
        'contentType': 'text/plain',
        'withCredentials': true
      }
    };

    this.withData = data => {
      serverRequest['data'] = JSON.stringify(data);
      return this;
    };

    this.withUrl = url => {
      serverRequest['url'] = url;
      return this;
    };

    this.withOptions = options => {
      serverRequest['options'] = options;
      return this;
    };

    this.build = () => serverRequest;
  }

  beforeEach(function() {
    element = {
      x: 0,
      y: 0,

      width: 0,
      height: 0,

      getBoundingClientRect: () => {
        return {
          width: element.width,
          height: element.height,

          left: element.x,
          top: element.y,
          right: element.x + element.width,
          bottom: element.y + element.height
        };
      }
    };
    win = {
      document: {
        visibilityState: 'visible'
      },

      innerWidth: 800,
      innerHeight: 600
    };

    bidRequests = [
      {
        bidId: 'b1',
        bidder: '33across',
        bidderRequestId: 'b1a',
        params: {
          siteId: SITE_ID,
          productId: PRODUCT_ID
        },
        adUnitCode: 'div-id',
        auctionId: 'r1',
        sizes: [
          [300, 250],
          [728, 90]
        ],
        transactionId: 't1'
      }
    ];

    sandbox = sinon.sandbox.create();
    sandbox.stub(document, 'getElementById').withArgs('div-id').returns(element);
    sandbox.stub(utils, 'getWindowTop').returns(win);
    sandbox.stub(utils, 'getWindowSelf').returns(win);
  });

  afterEach(function() {
    sandbox.restore();
  });

  describe('isBidRequestValid:', function() {
    it('returns true when valid bid request is sent', function() {
      const validBid = {
        bidder: BIDDER_CODE,
        params: {
          siteId: SITE_ID,
          productId: PRODUCT_ID
        }
      };

      expect(spec.isBidRequestValid(validBid)).to.be.true;
    });

    it('returns true when valid test bid request is sent', function() {
      const validBid = {
        bidder: BIDDER_CODE,
        params: {
          siteId: SITE_ID,
          productId: PRODUCT_ID,
          test: 1
        }
      };

      expect(spec.isBidRequestValid(validBid)).to.be.true;
    });

    it('returns false when bidder not set to "33across"', function() {
      const invalidBid = {
        bidder: 'foo',
        params: {
          siteId: SITE_ID,
          productId: PRODUCT_ID
        }
      };

      expect(spec.isBidRequestValid(invalidBid)).to.be.false;
    });

    it('returns false when params not set', function() {
      const invalidBid = {
        bidder: 'foo'
      };

      expect(spec.isBidRequestValid(invalidBid)).to.be.false;
    });

    it('returns false when site ID is not set in params', function() {
      const invalidBid = {
        bidder: 'foo',
        params: {
          productId: PRODUCT_ID
        }
      };

      expect(spec.isBidRequestValid(invalidBid)).to.be.false;
    });

    it('returns false when product ID not set in params', function() {
      const invalidBid = {
        bidder: 'foo',
        params: {
          siteId: SITE_ID
        }
      };

      expect(spec.isBidRequestValid(invalidBid)).to.be.false;
    });
  });

  describe('buildRequests:', function() {
    context('when element is fully in view', function() {
      it('returns 100', function() {
        const ttxRequest = new TtxRequestBuilder()
          .withViewabiliuty({amount: 100})
          .build();
        const serverRequest = new ServerRequestBuilder()
          .withData(ttxRequest)
          .build();

        Object.assign(element, { width: 600, height: 400 });

        expect(spec.buildRequests(bidRequests)).to.deep.equal([ serverRequest ]);
      });
    });

    context('when element is out of view', function() {
      it('returns 0', function() {
        const ttxRequest = new TtxRequestBuilder()
          .withViewabiliuty({amount: 0})
          .build();
        const serverRequest = new ServerRequestBuilder()
          .withData(ttxRequest)
          .build();

        Object.assign(element, { x: -300, y: 0, width: 207, height: 320 });

        expect(spec.buildRequests(bidRequests)).to.deep.equal([ serverRequest ]);
      });
    });

    context('when element is partially in view', function() {
      it('returns percentage', function() {
        const ttxRequest = new TtxRequestBuilder()
          .withViewabiliuty({amount: 75})
          .build();
        const serverRequest = new ServerRequestBuilder()
          .withData(ttxRequest)
          .build();

        Object.assign(element, { width: 800, height: 800 });

        expect(spec.buildRequests(bidRequests)).to.deep.equal([ serverRequest ]);
      });
    });

    context('when width or height of the element is zero', function() {
      it('try to use alternative values', function() {
        const ttxRequest = new TtxRequestBuilder()
          .withSizes([{ w: 800, h: 2400, ext: {} }])
          .withViewabiliuty({amount: 25})
          .build();
        const serverRequest = new ServerRequestBuilder()
          .withData(ttxRequest)
          .build();

        Object.assign(element, { width: 0, height: 0 });
        bidRequests[0].sizes = [[800, 2400]];

        expect(spec.buildRequests(bidRequests)).to.deep.equal([ serverRequest ]);
      });
    });

    context('when nested iframes', function() {
      it('returns \'nm\'', function() {
        const ttxRequest = new TtxRequestBuilder()
          .withViewabiliuty({amount: spec.NON_MEASURABLE})
          .build();
        const serverRequest = new ServerRequestBuilder()
          .withData(ttxRequest)
          .build();

        Object.assign(element, { width: 600, height: 400 });

        utils.getWindowTop.restore();
        utils.getWindowSelf.restore();
        sandbox.stub(utils, 'getWindowTop').returns(win);
        sandbox.stub(utils, 'getWindowSelf').returns({});

        expect(spec.buildRequests(bidRequests)).to.deep.equal([ serverRequest ]);
      });
    });

    context('when tab is inactive', function() {
      it('returns 0', function() {
        const ttxRequest = new TtxRequestBuilder()
          .withViewabiliuty({amount: 0})
          .build();
        const serverRequest = new ServerRequestBuilder()
          .withData(ttxRequest)
          .build();

        Object.assign(element, { width: 600, height: 400 });

        utils.getWindowTop.restore();
        win.document.visibilityState = 'hidden';
        sandbox.stub(utils, 'getWindowTop').returns(win);

        expect(spec.buildRequests(bidRequests)).to.deep.equal([ serverRequest ]);
      });
    });

    context('when gdpr consent data exists', function() {
      let bidderRequest;

      beforeEach(function() {
        bidderRequest = {
          gdprConsent: {
            consentString: 'foobarMyPreference',
            gdprApplies: true
          }
        }
      });

      it('returns corresponding server requests with gdpr consent data', function() {
        const ttxRequest = new TtxRequestBuilder()
          .withGdprConsent('foobarMyPreference', 1)
          .build();
        const serverRequest = new ServerRequestBuilder()
          .withData(ttxRequest)
          .build();
        const builtServerRequests = spec.buildRequests(bidRequests, bidderRequest);

        expect(builtServerRequests).to.deep.equal([serverRequest]);
      });

      it('returns corresponding test server requests with gdpr consent data', function() {
        sandbox.stub(config, 'getConfig').callsFake(() => {
          return {
            'url': 'https://foo.com/hb/'
          }
        });

        const ttxRequest = new TtxRequestBuilder()
          .withGdprConsent('foobarMyPreference', 1)
          .build();
        const serverRequest = new ServerRequestBuilder()
          .withData(ttxRequest)
          .withUrl('https://foo.com/hb/')
          .build();
        const builtServerRequests = spec.buildRequests(bidRequests, bidderRequest);

        expect(builtServerRequests).to.deep.equal([serverRequest]);
      });
    });

    context('when gdpr consent data does not exist', function() {
      let bidderRequest;

      beforeEach(function() {
        bidderRequest = {};
      });

      it('returns corresponding server requests with default gdpr consent data', function() {
        const ttxRequest = new TtxRequestBuilder()
          .build();
        const serverRequest = new ServerRequestBuilder()
          .withData(ttxRequest)
          .build();
        const builtServerRequests = spec.buildRequests(bidRequests, bidderRequest);

        expect(builtServerRequests).to.deep.equal([serverRequest]);
      });

      it('returns corresponding test server requests with default gdpr consent data', function() {
        sandbox.stub(config, 'getConfig').callsFake(() => {
          return {
            'url': 'https://foo.com/hb/'
          }
        });

        const ttxRequest = new TtxRequestBuilder()
          .build();
        const serverRequest = new ServerRequestBuilder()
          .withData(ttxRequest)
          .withUrl('https://foo.com/hb/')
          .build();
        const builtServerRequests = spec.buildRequests(bidRequests, bidderRequest);

        expect(builtServerRequests).to.deep.equal([serverRequest]);
      });
    });
  });

  describe('interpretResponse', function() {
    let ttxRequest, serverRequest;

    beforeEach(function() {
      ttxRequest = new TtxRequestBuilder()
        .withSite({
          id: SITE_ID,
          page: 'http://test-url.com'
        })
        .build();
      serverRequest = new ServerRequestBuilder()
        .withUrl('//staging-ssc.33across.com/api/v1/hb')
        .withData(ttxRequest)
        .withOptions({
          contentType: 'text/plain',
          withCredentials: false
        })
        .build();
    });

    context('when exactly one bid is returned', function() {
      it('interprets and returns the single bid response', function() {
        const serverResponse = {
          cur: 'USD',
          ext: {},
          id: 'b1',
          seatbid: [
            {
              bid: [{
                id: '1',
                adm: '<html><h3>I am an ad</h3></html>',
                crid: 1,
                h: 250,
                w: 300,
                price: 0.0938
              }]
            }
          ]
        };
        const bidResponse = {
          requestId: 'b1',
          bidderCode: BIDDER_CODE,
          cpm: 0.0938,
          width: 300,
          height: 250,
          ad: '<html><h3>I am an ad</h3></html>',
          ttl: 60,
          creativeId: '23455',
          currency: 'USD',
          netRevenue: true
        };

        expect(spec.interpretResponse({ body: serverResponse }, serverRequest)).to.deep.equal([bidResponse]);
      });
    });

    context('when no bids are returned', function() {
      it('interprets and returns empty array', function() {
        const serverResponse = {
          cur: 'USD',
          ext: {},
          id: 'b1',
          seatbid: []
        };

        expect(spec.interpretResponse({ body: serverResponse }, serverRequest)).to.deep.equal([]);
      });
    });

    context('when more than one bids are returned', function() {
      it('interprets and returns the the first bid of the first seatbid', function() {
        const serverResponse = {
          cur: 'USD',
          ext: {},
          id: 'b1',
          seatbid: [
            {
              bid: [{
                id: '1',
                adm: '<html><h3>I am an ad</h3></html>',
                crid: 1,
                h: 250,
                w: 300,
                price: 0.0940,
                crid: 1
              },
              {
                id: '2',
                adm: '<html><h3>I am an ad</h3></html>',
                crid: 2,
                h: 250,
                w: 300,
                price: 0.0938,
                crid: 2
              }
              ]
            },
            {
              bid: [{
                id: '3',
                adm: '<html><h3>I am an ad</h3></html>',
                crid: 3,
                h: 250,
                w: 300,
                price: 0.0938
              }]
            }
          ]
        };
        const bidResponse = {
          requestId: 'b1',
          bidderCode: BIDDER_CODE,
          cpm: 0.0940,
          width: 300,
          height: 250,
          ad: '<html><h3>I am an ad</h3></html>',
          ttl: 60,
          creativeId: 1,
          currency: 'USD',
          netRevenue: true
        };

        expect(spec.interpretResponse({ body: serverResponse }, serverRequest)).to.deep.equal([bidResponse]);
      });
    });
  });

  describe('getUserSyncs', function() {
    let syncs;

    beforeEach(function() {
      syncs = [
        {
          type: 'iframe',
          url: 'https://de.tynt.com/deb/v2?m=xch&rt=html&id=id1'
        },
        {
          type: 'iframe',
          url: 'https://de.tynt.com/deb/v2?m=xch&rt=html&id=id2'
        },
      ];
      bidRequests = [
        {
          bidId: 'b1',
          bidder: '33across',
          bidderRequestId: 'b1a',
          params: {
            siteId: 'id1',
            productId: 'foo'
          },
          adUnitCode: 'div-id',
          auctionId: 'r1',
          sizes: [
            [300, 250]
          ],
          transactionId: 't1'
        },
        {
          bidId: 'b2',
          bidder: '33across',
          bidderRequestId: 'b2a',
          params: {
            siteId: 'id2',
            productId: 'foo'
          },
          adUnitCode: 'div-id',
          auctionId: 'r1',
          sizes: [
            [300, 250]
          ],
          transactionId: 't2'
        }
      ];
    });

    context('when gdpr does not apply', function() {
      let gdprConsent;

      beforeEach(function() {
        gdprConsent = {
          gdprApplies: false
        };
      });

      context('when iframe is not enabled', function() {
        it('returns empty sync array', function() {
          const syncOptions = {};

          spec.buildRequests(bidRequests);

          expect(spec.getUserSyncs(syncOptions, {}, gdprConsent)).to.deep.equal([]);
        });
      });

      context('when iframe is enabled', function() {
        it('returns sync array equal to number of unique siteIDs', function() {
          const syncOptions = {
            iframeEnabled: true
          };

          spec.buildRequests(bidRequests);

          expect(spec.getUserSyncs(syncOptions, {}, gdprConsent)).to.deep.equal(syncs);
        });
      });
    });

    context('when consent data is not defined', function() {
      context('when iframe is not enabled', function() {
        it('returns empty sync array', function() {
          const syncOptions = {};

          spec.buildRequests(bidRequests);

          expect(spec.getUserSyncs(syncOptions)).to.deep.equal([]);
        });
      });

      context('when iframe is enabled', function() {
        it('returns sync array equal to number of unique siteIDs', function() {
          const syncOptions = {
            iframeEnabled: true
          };

          spec.buildRequests(bidRequests);

          expect(spec.getUserSyncs(syncOptions)).to.deep.equal(syncs);
        });
      });
    });

    context('when gdpr applies', function() {
      it('returns empty sync array', function() {
        const syncOptions = {};
        const gdprConsent = {
          gdprApplies: true
        };

        spec.buildRequests(bidRequests);

        expect(spec.getUserSyncs(syncOptions, {}, gdprConsent)).to.deep.equal([]);
      });
    })
  });
});
